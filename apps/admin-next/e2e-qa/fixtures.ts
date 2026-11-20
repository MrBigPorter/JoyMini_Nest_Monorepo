/**
 * Batch 1 QA Playwright fixture — real admin + real API.
 *
 * It deliberately does NOT mock /api. The session is a *signed* admin JWT
 * (ADMIN_JWT_SECRET from qa/.env.qa), so the API actually authenticates it and
 * /auth/admin/me returns the seeded QA admin row.
 */
import { test as base, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as jwt from 'jsonwebtoken';

export { expect };

const QA_ENV_FILE = path.resolve(__dirname, '../../../qa/.env.qa');

function readQaEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (!fs.existsSync(QA_ENV_FILE)) return env;
  for (const line of fs.readFileSync(QA_ENV_FILE, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

const QA_ENV = readQaEnv();
// qa/.env.qa is authoritative; a developer shell exporting the dev secret must
// not silently sign tokens that the QA API will reject.
const ADMIN_SECRET =
  QA_ENV.ADMIN_JWT_SECRET ??
  process.env.ADMIN_JWT_SECRET ??
  'qa_admin_jwt_secret_change_me_0123456789';

export type QaRole = 'VIEWER' | 'EDITOR' | 'ADMIN' | 'SUPER_ADMIN';

const ROLE_IDS: Record<QaRole, string> = {
  VIEWER: 'qa_admin_viewer',
  EDITOR: 'qa_admin_editor',
  ADMIN: 'qa_admin_admin',
  SUPER_ADMIN: 'qa_admin_super',
};

export function tokenForRole(role: QaRole): string {
  return jwt.sign(
    {
      sub: ROLE_IDS[role],
      role,
      type: 'admin',
      username: `qa_${role.toLowerCase()}`,
    },
    ADMIN_SECRET,
    { expiresIn: '2h' },
  );
}

export interface RecordedRequest {
  method: string;
  url: URL;
}

export const test = base.extend<{
  role: QaRole;
  requests: RecordedRequest[];
}>({
  role: ['ADMIN', { option: true }],

  requests: async ({ page }, use) => {
    const requests: RecordedRequest[] = [];
    page.on('request', (request) => {
      requests.push({ method: request.method(), url: new URL(request.url()) });
    });
    await use(requests);
  },

  // Inject the session before every page, and keep the browser hermetic:
  // only the admin origin and the QA API origin are reachable.
  page: async ({ page, context, baseURL, role }, use) => {
    const adminOrigin = new URL(baseURL ?? 'http://127.0.0.1:4101').origin;
    const apiOrigin = new URL(
      process.env.QA_API_URL ?? QA_ENV.QA_API_URL ?? 'http://127.0.0.1:4102/api',
    ).origin;
    const token = tokenForRole(role);

    await context.addCookies([
      { name: 'auth_token', value: token, url: adminOrigin },
    ]);
    await context.addInitScript((accessToken) => {
      try {
        localStorage.setItem('auth_token', accessToken);
      } catch {
        // localStorage unavailable; the cookie still satisfies middleware.
      }
    }, token);

    await page.route('**/*', (route) => {
      const origin = new URL(route.request().url()).origin;
      if (origin === adminOrigin || origin === apiOrigin) {
        return route.continue();
      }
      return route.abort();
    });

    await use(page);
  },
});

/** Wait until the client-side session has loaded the seeded role. */
export async function waitForRole(page: Page, role: QaRole): Promise<void> {
  const displayName =
    role === 'SUPER_ADMIN'
      ? 'QA Super Admin'
      : role === 'ADMIN'
        ? 'QA Admin'
        : role === 'EDITOR'
          ? 'QA Editor'
          : 'QA Viewer';
  await expect(page.getByText(displayName, { exact: true }).first()).toBeVisible({
    timeout: 120_000,
  });
}
