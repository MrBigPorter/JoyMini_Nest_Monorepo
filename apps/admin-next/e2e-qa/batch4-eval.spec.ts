/**
 * Batch 4 — eval UI (real admin + real API).
 *
 * Covers:
 *   1. 加入回归 requires an expected answer; the payload carries
 *      expected/sourceFeedbackId/source and expect.mustMention.
 *   2. A FAILED run shows summary.error and stops polling.
 *   3. A COMPLETED run stops polling and renders the summary.
 *
 * The QA judge stub returns 500 for questions containing `qa_judge_fail`,
 * making the FAILED run deterministic.
 */
import { execSync } from 'node:child_process';
import {
  test,
  expect,
  waitForRole,
  tokenForRole,
  QA_ENV,
} from './fixtures';

const API_BASE = (
  process.env.QA_API_URL ??
  QA_ENV.QA_API_URL ??
  'http://127.0.0.1:4102/api'
).replace(/\/$/, '');
const ADMIN_TOKEN = tokenForRole('ADMIN');

let addDatasetId = '';
let failDatasetId = '';
let passDatasetId = '';

function cleanUiData(): void {
  const sql =
    "DELETE FROM ai_scores WHERE metadata->>'evalRunId' IN (" +
    'SELECT id FROM ai_eval_runs WHERE dataset_id IN (' +
    "SELECT id FROM ai_eval_datasets WHERE name LIKE 'qa_b4_ui_%')); " +
    "DELETE FROM ai_eval_datasets WHERE name LIKE 'qa_b4_ui_%'; " +
    "UPDATE ai_answer_feedback SET resolution='OPEN', review_status='PENDING', " +
    "linked_eval_case_id=NULL WHERE id='qa_fb_explicit_1';";
  try {
    execSync(
      `docker exec lucky-db-qa psql -U lucky -d joy_mini_qa -c "${sql}"`,
      { stdio: 'pipe', timeout: 30_000 },
    );
  } catch {
    // Best-effort cleanup; the test still works if Docker is unavailable.
  }
}

async function api(
  method: string,
  endpoint: string,
  body?: unknown,
): Promise<any> {
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

async function createDataset(name: string): Promise<string> {
  const data = await api('POST', '/v1/admin/ai-eval/datasets', { name });
  return data.id;
}

async function addCase(
  datasetId: string,
  question: string,
  mustMention: string,
): Promise<void> {
  await api('POST', `/v1/admin/ai-eval/datasets/${datasetId}/cases`, {
    cases: [
      {
        question,
        answer: 'qa_b4_ui_answer',
        expect: { mustMention: [mustMention] },
      },
    ],
  });
}

test.beforeAll(async () => {
  cleanUiData();
  addDatasetId = await createDataset('qa_b4_ui_dataset');
  failDatasetId = await createDataset('qa_b4_ui_fail');
  passDatasetId = await createDataset('qa_b4_ui_pass');
  await addCase(failDatasetId, 'qa_judge_fail_question', 'x');
  await addCase(passDatasetId, 'qa_b4_ui_pass_q', 'refund');
});

test.afterAll(() => {
  cleanUiData();
});

const RUN_REQUESTS = (requests: Array<{ method: string; url: URL }>) =>
  requests.filter(
    (r) =>
      r.method === 'GET' && /\/ai-eval\/runs\/[^/]+$/.test(r.url.pathname),
  ).length;

test.describe.serial('Batch 4 — eval UI', () => {
  test.use({ role: 'ADMIN' });

  test('加入回归 requires an expected answer and sends lineage fields', async ({
    page,
    requests,
  }) => {
    await page.goto('/ai-ops/quality');
    await expect(
      page.getByRole('heading', { name: 'AI 质量' }),
    ).toBeVisible({ timeout: 180_000 });
    await waitForRole(page, 'ADMIN');

    const row = page.locator('tbody tr', {
      hasText: 'qa_user_question_secret_1',
    });
    await expect(row).toBeVisible({ timeout: 120_000 });
    await row.getByRole('button', { name: '加入回归' }).click();

    // Pick the dedicated dataset (other QA datasets may exist).
    await page.getByLabel('选择回归评测集').selectOption(addDatasetId);

    // Empty prompt → error, no addCases request.
    const postsBefore = requests.filter(
      (r) => r.method === 'POST' && r.url.pathname.endsWith('/cases'),
    ).length;
    page.once('dialog', (dialog) => void dialog.dismiss());
    await page.getByRole('button', { name: '确认加入回归' }).click();
    await expect(
      page.getByText('回归用例必须填写期望答案'),
    ).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(600);
    const postsAfterEmpty = requests.filter(
      (r) => r.method === 'POST' && r.url.pathname.endsWith('/cases'),
    ).length;
    expect(postsAfterEmpty).toBe(postsBefore);

    // With an expected answer → payload includes expected/source/feedback id.
    const caseRequest = page.waitForRequest(
      (req) =>
        req.method() === 'POST' && req.url().endsWith('/cases'),
      { timeout: 60_000 },
    );
    page.once('dialog', (dialog) =>
      void dialog.accept('must mention 7 days'),
    );
    await page.getByRole('button', { name: '确认加入回归' }).click();
    const req = await caseRequest;
    const payload = req.postDataJSON();
    const added = payload.cases[0];
    expect(added.expect).toEqual({ mustMention: ['must mention 7 days'] });
    expect(added.expected).toBe('must mention 7 days');
    expect(added.source).toBe('feedback');
    expect(added.sourceFeedbackId).toBe('qa_fb_explicit_1');
    await expect(page.getByText('已加入回归评测集')).toBeVisible({
      timeout: 60_000,
    });
  });

  test('FAILED run shows the failure reason and stops polling', async ({
    page,
    requests,
  }) => {
    await page.goto('/ai-ops/quality');
    await expect(
      page.getByRole('heading', { name: 'AI 质量' }),
    ).toBeVisible({ timeout: 180_000 });
    await waitForRole(page, 'ADMIN');
    await page.getByRole('button', { name: '回归测试' }).click();

    await page.getByLabel('选择评测集').selectOption(failDatasetId);
    await expect(
      page.getByRole('button', { name: '启动批量评测' }),
    ).toBeVisible({ timeout: 120_000 });

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: '启动批量评测' }).click();

    await expect(page.getByText(/失败原因：/)).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByText(/失败原因：/)).toContainText(
      /judge|失败/i,
    );

    const countAtFailed = RUN_REQUESTS(requests);
    await page.waitForTimeout(4500);
    expect(RUN_REQUESTS(requests)).toBe(countAtFailed);
  });

  test('COMPLETED run renders the summary and stops polling', async ({
    page,
    requests,
  }) => {
    await page.goto('/ai-ops/quality');
    await expect(
      page.getByRole('heading', { name: 'AI 质量' }),
    ).toBeVisible({ timeout: 180_000 });
    await waitForRole(page, 'ADMIN');
    await page.getByRole('button', { name: '回归测试' }).click();

    await page.getByLabel('选择评测集').selectOption(passDatasetId);
    await expect(
      page.getByRole('button', { name: '启动批量评测' }),
    ).toBeVisible({ timeout: 120_000 });

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: '启动批量评测' }).click();

    await expect(page.getByText(/通过率\s*100\.0%/)).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByText(/共 1 条 · 解决 1/)).toBeVisible({
      timeout: 30_000,
    });

    const countAtCompleted = RUN_REQUESTS(requests);
    await page.waitForTimeout(4500);
    expect(RUN_REQUESTS(requests)).toBe(countAtCompleted);
  });
});
