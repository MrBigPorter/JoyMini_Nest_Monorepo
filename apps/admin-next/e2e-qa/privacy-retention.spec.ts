/**
 * Privacy QA — VIEWER eval detail must not show raw question/answer/expected.
 *
 * beforeAll creates a dedicated dataset + case via the ADMIN API; the page is
 * opened as VIEWER. afterAll removes it via psql (cascade).
 */
import { execSync } from 'node:child_process';
import { test, expect, waitForRole, tokenForRole, QA_ENV } from './fixtures';

const API_BASE = (
  process.env.QA_API_URL ??
  QA_ENV.QA_API_URL ??
  'http://127.0.0.1:4102/api'
).replace(/\/$/, '');
const ADMIN_TOKEN = tokenForRole('ADMIN');

let datasetId = '';

const SECRETS = [
  'qa_pr_ui_secret_question',
  'qa_pr_ui_secret_answer',
  'qa_pr_ui_secret_expected',
  'qa_pr_ui_secret_expect',
];

async function api(method: string, endpoint: string, body?: unknown) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`${method} ${endpoint} -> ${res.status}: ${json.message}`);
  }
  return json.data;
}

test.beforeAll(async () => {
  try {
    execSync(
      `docker exec lucky-db-qa psql -U lucky -d joy_mini_qa -c ` +
        `"DELETE FROM ai_eval_datasets WHERE name LIKE 'qa_pr_ui_%';"`,
      { stdio: 'pipe', timeout: 30_000 },
    );
  } catch {
    // best-effort cleanup
  }
  const dataset = await api('POST', '/v1/admin/ai-eval/datasets', {
    name: 'qa_pr_ui_dataset',
  });
  datasetId = dataset.id;
  await api('POST', `/v1/admin/ai-eval/datasets/${datasetId}/cases`, {
    cases: [
      {
        question: 'qa_pr_ui_secret_question',
        answer: 'qa_pr_ui_secret_answer',
        expect: { mustMention: ['qa_pr_ui_secret_expect'] },
        expected: 'qa_pr_ui_secret_expected',
      },
    ],
  });
});

test.afterAll(() => {
  try {
    execSync(
      `docker exec lucky-db-qa psql -U lucky -d joy_mini_qa -c ` +
        `"DELETE FROM ai_eval_datasets WHERE name LIKE 'qa_pr_ui_%';"`,
      { stdio: 'pipe', timeout: 30_000 },
    );
  } catch {
    // best-effort cleanup
  }
});

test.describe('Privacy — VIEWER eval detail', () => {
  test.use({ role: 'VIEWER' });

  test('VIEWER sees no raw case question/answer/expected', async ({ page }) => {
    await page.goto('/ai-ops/quality');
    await expect(page.getByRole('heading', { name: 'AI 质量' })).toBeVisible({
      timeout: 180_000,
    });
    await waitForRole(page, 'VIEWER');

    await page.getByRole('button', { name: '回归测试' }).click();
    await page.getByLabel('选择评测集').selectOption(datasetId);

    // Wait for the dataset detail/case list to render.
    await expect(
      page.getByRole('heading', { name: 'qa_pr_ui_dataset' }),
    ).toBeVisible({ timeout: 120_000 });
    await expect(page.getByRole('heading', { name: /用例（1）/ })).toBeVisible({
      timeout: 120_000,
    });

    const body = await page.locator('body').innerText();
    for (const secret of SECRETS) {
      expect(body).not.toContain(secret);
    }

    // The redacted detail should still be the dataset (no crash).
    await expect(page.getByText('期望：未填写').first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
