/**
 * Insights metrics QA (commit 42ee6d76, included in 301cff59).
 *
 * Controlled UTC day 2026-11-15 via qa/seed/insights-metrics.ts:
 *   conversations=2; transfers 2/3=0.667 (explicit_request + ai_error)
 *   modelError 2/3; serviceError 2/4; misTransfer 1/4
 *   suspectedMisTransfer/transferred=5
 * Human reply: admin reply writes ChatMessage.source='human_agent'; customer stays user.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '@api/common/prisma/prisma.service';

const QA_ENV_FILE = path.resolve(__dirname, '../../../../qa/.env.qa');
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

const ENV = readQaEnv();
for (const [key, value] of Object.entries(ENV)) process.env[key] = value;

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const API_BASE = (ENV.QA_API_URL ?? 'http://127.0.0.1:4102/api').replace(
  /\/$/,
  '',
);
const TOKEN = jwt.sign(
  { sub: 'qa_admin_admin', role: 'ADMIN', type: 'admin', username: 'qa_admin' },
  ENV.ADMIN_JWT_SECRET ?? 'qa_admin_jwt_secret_change_me_0123456789',
  { expiresIn: '1h' },
);
const D = '2026-11-15';
const TODAY = new Date().toISOString().slice(0, 10);

const prisma = new PrismaService();

interface ApiResult {
  status: number;
  body: any;
  data: any;
}

async function api(
  method: string,
  endpoint: string,
  body?: unknown,
): Promise<ApiResult> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  return { status: res.status, body: parsed, data: parsed?.data };
}

async function waitForApi(): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_BASE}/v1/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`QA API not reachable at ${API_BASE}`);
}

function runSeed(args: string): void {
  execSync(`npx tsx qa/seed/insights-metrics.ts ${args}`, {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: ENV.DATABASE_URL },
    stdio: 'pipe',
    timeout: 120_000,
  });
}

beforeAll(async () => {
  await waitForApi();
  runSeed('');
});

// The D data is intentionally left for the Playwright page spec; its afterAll
// runs the seed with --clean.
afterAll(async () => {
  await prisma.$disconnect();
});

describe('Insights — transfer rate and rates', () => {
  it('computes the D-window transfer rate and byReason', async () => {
    const res = await api(
      'GET',
      `/v1/admin/ai-insights/overview?from=${D}&to=${D}`,
    );
    expect(res.status).toBe(200);
    expect(res.data.conversations).toBe(2);
    expect(res.data.transfers).toMatchObject({
      total: 2,
      numerator: 2,
      denominator: 3,
      rate: 0.667,
    });
    expect(res.data.transfers.rate).toBeLessThanOrEqual(1);
    const reasons = Object.fromEntries(
      res.data.transfers.byReason.map((row: any) => [row.reason, row.count]),
    );
    expect(reasons).toEqual({ explicit_request: 1, ai_error: 1 });
  });

  it('computes modelError/serviceError/misTransfer from failureKind', async () => {
    const res = await api(
      'GET',
      `/v1/admin/ai-insights/overview?from=${D}&to=${D}`,
    );
    expect(res.data.rates.modelError).toEqual({
      numerator: 2,
      denominator: 3,
      rate: 0.667,
    });
    expect(res.data.rates.serviceError).toEqual({
      numerator: 2,
      denominator: 4,
      rate: 0.5,
    });
    // Only the human-confirmed UNEXPECTED_TRANSFER counts; the implicit
    // transferred signals do not.
    expect(res.data.rates.misTransfer).toEqual({
      numerator: 1,
      denominator: 4,
      rate: 0.25,
    });
    expect(res.data.feedback.transferred).toBe(5);
    expect(res.data.feedback.suspectedMisTransfer).toBe(5);
    expect(res.data.feedback.repeatedQuestion).toBe(0);
    expect(res.data.feedback.abandoned).toBe(0);
  });
});

describe('Insights — human agent messages', () => {
  it('admin reply writes human_agent; customer stays user; messages.human increases', async () => {
    const before = await api(
      'GET',
      `/v1/admin/ai-insights/overview?from=${TODAY}&to=${TODAY}`,
    );
    const humanBefore = before.data.messages.human;

    const reply = await api(
      'POST',
      '/v1/admin/chat/conversations/qa_im_conv_human/reply',
      { content: 'qa_im_human_reply' },
    );
    expect([200, 201]).toContain(reply.status);

    const humanMessage = await prisma.chatMessage.findFirst({
      where: {
        conversationId: 'qa_im_conv_human',
        content: 'qa_im_human_reply',
      },
    });
    expect(humanMessage?.source).toBe('human_agent');

    const userMessage = await prisma.chatMessage.findFirst({
      where: { id: 'qa_im_msg_user' },
    });
    expect(userMessage?.source).toBe('user');
    const aiMessage = await prisma.chatMessage.findFirst({
      where: { id: 'qa_im_msg_ai' },
    });
    expect(aiMessage?.source).toBe('ai');

    const after = await api(
      'GET',
      `/v1/admin/ai-insights/overview?from=${TODAY}&to=${TODAY}`,
    );
    expect(after.data.messages.human).toBe(humanBefore + 1);
  });
});
