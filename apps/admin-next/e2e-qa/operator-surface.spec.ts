/**
 * 119 operator surface QA (frozen ec114966 / operator commit 55b0380c).
 *
 * Real admin + real API. qa/seed/operator-surface.ts seeds service/model
 * feedback plus confirmed rows and conversations with transfer metadata.
 * Covers batch-exclude, claim/fix/close, review shortcuts + main reason
 * persistence, and the RAG zero-hit checklist.
 */
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { test, expect, waitForRole, QA_ENV } from './fixtures';

const repoRoot = path.resolve(__dirname, '../../..');
const seedFile = path.join(repoRoot, 'qa/seed/operator-surface.ts');

function seed(args: string[] = []): string {
  return execFileSync('npx', ['tsx', seedFile, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL:
        QA_ENV.DATABASE_URL ??
        'postgresql://lucky:lucky_qa_pw@127.0.0.1:5433/joy_mini_qa?schema=public',
    },
    encoding: 'utf8',
  }).trim();
}

interface FeedbackRow {
  id: string;
  reviewStatus: string;
  resolution: string;
  failureKind: string;
  ownerAdminId: string | null;
}

function inspect(): FeedbackRow[] {
  return JSON.parse(seed(['inspect'])) as FeedbackRow[];
}

function rowById(rows: FeedbackRow[], id: string): FeedbackRow {
  const row = rows.find((item) => item.id === id);
  if (!row) throw new Error(`missing feedback row ${id}`);
  return row;
}

test.describe('ADMIN — quality operator surface', () => {
  test.use({ role: 'ADMIN' });

  test.beforeAll(() => {
    seed();
  });

  test.afterAll(() => {
    seed(['--clean']);
  });

  test('batch exclude only SERVICE_ERROR on the current page', async ({
    page,
  }) => {
    await page.goto(
      '/ai-ops/quality?failureKind=SERVICE_ERROR&from=2027-03-01&to=2027-03-01',
    );
    await expect(page.getByRole('heading', { name: 'AI 质量' })).toBeVisible({
      timeout: 180_000,
    });
    await waitForRole(page, 'ADMIN');
    await expect(
      page.getByText('qa_op_service_input_1', { exact: true }),
    ).toBeVisible({ timeout: 60_000 });

    const button = page.getByRole('button', {
      name: /批量排除服务故障（2）/,
    });
    await expect(button).toBeEnabled();
    page.once('dialog', (dialog) => void dialog.accept());
    await button.click();
    await expect(
      page.getByText('已批量排除 2 条服务故障', { exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    const rows = inspect();
    expect(rowById(rows, 'qa_op_fb_service_1')).toMatchObject({
      reviewStatus: 'IGNORED',
      resolution: 'EXCLUDED',
    });
    expect(rowById(rows, 'qa_op_fb_service_2')).toMatchObject({
      reviewStatus: 'IGNORED',
      resolution: 'EXCLUDED',
    });
    // Model errors are untouched.
    expect(rowById(rows, 'qa_op_fb_model_1')).toMatchObject({
      reviewStatus: 'PENDING',
      resolution: 'OPEN',
    });
    expect(rowById(rows, 'qa_op_fb_model_2')).toMatchObject({
      reviewStatus: 'PENDING',
      resolution: 'OPEN',
    });
  });

  test('marks confirmed rows fixed-pending-verify and closed', async ({
    page,
  }) => {
    await page.goto(
      '/ai-ops/quality?resolution=CONFIRMED&from=2027-03-01&to=2027-03-01',
    );
    await expect(page.getByRole('heading', { name: 'AI 质量' })).toBeVisible({
      timeout: 180_000,
    });
    await waitForRole(page, 'ADMIN');
    const first = page
      .getByRole('row')
      .filter({ hasText: 'qa_op_confirmed_input_1' })
      .first();
    await expect(first).toBeVisible({ timeout: 60_000 });
    await first.getByRole('button', { name: '标记已修复待验证' }).click();
    await expect(
      page.getByText('已标记为已修复待验证', { exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    const second = page
      .getByRole('row')
      .filter({ hasText: 'qa_op_confirmed_input_2' })
      .first();
    await second.getByRole('button', { name: '关闭' }).click();
    await expect(page.getByText('已标记为已关闭', { exact: true })).toBeVisible(
      { timeout: 30_000 },
    );

    const rows = inspect();
    expect(rowById(rows, 'qa_op_fb_confirmed_1').resolution).toBe(
      'FIXED_PENDING_VERIFY',
    );
    expect(rowById(rows, 'qa_op_fb_confirmed_2').resolution).toBe('CLOSED');
  });

  test('review card shows transfer metadata and shortcuts persist main reason', async ({
    page,
  }) => {
    await page.goto(
      '/ai-ops/quality?failureKind=MODEL_ERROR&resolution=OPEN&from=2027-03-01&to=2027-03-01',
    );
    await expect(page.getByRole('heading', { name: 'AI 质量' })).toBeVisible({
      timeout: 180_000,
    });
    await waitForRole(page, 'ADMIN');

    // Claim writes ownerAdminId.
    const firstModelRow = page
      .getByRole('row')
      .filter({ hasText: 'qa_op_model_input_1' })
      .first();
    await expect(firstModelRow).toBeVisible({ timeout: 60_000 });
    await firstModelRow.getByRole('button', { name: '认领' }).click();
    await expect(
      page.getByText('已认领，负责人是你', { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    expect(rowById(inspect(), 'qa_op_fb_model_1').ownerAdminId).toBe(
      'qa_admin_admin',
    );

    await page.getByRole('button', { name: '开始质检' }).click();
    await expect(page.getByText(/质检 1 \/ 2/)).toBeVisible({
      timeout: 30_000,
    });

    // Quality card metadata (first row is model_1 on conv_1).
    await expect(
      page.getByText('转人工原因：用户明确要求', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('处理客服：人工客服（qa_admin）', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('负责人：我', { exact: true })).toBeVisible();

    // J/K navigation.
    await page.keyboard.press('j');
    await expect(page.getByText(/质检 2 \/ 2/)).toBeVisible();
    await page.keyboard.press('k');
    await expect(page.getByText(/质检 1 \/ 2/)).toBeVisible();

    // 1/2/3 select the decision; 2 = confirm, then choose main reason.
    await page.keyboard.press('1');
    await expect(page.getByText('当前选择：回答正确')).toBeVisible();
    await page.keyboard.press('3');
    await expect(page.getByText('当前选择：排除')).toBeVisible();
    await page.keyboard.press('2');
    await expect(page.getByText('当前选择：确认问题')).toBeVisible();
    await page.getByLabel('主要原因').selectOption('MODEL_ERROR');
    await page.getByRole('heading', { name: 'AI 质量' }).click();

    const patch = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().includes('/ai-feedback/'),
    );
    await page.keyboard.press('Enter');
    const response = await patch;
    expect(response.status()).toBe(200);
    const id = response.url().split('/ai-feedback/')[1]?.split('?')[0];
    expect(id).toBeTruthy();

    const saved = rowById(inspect(), id!);
    expect(saved).toMatchObject({
      reviewStatus: 'REVIEWED',
      resolution: 'CONFIRMED',
      failureKind: 'MODEL_ERROR',
    });

    // Esc exits review mode.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '开始质检' })).toBeVisible();
  });

  test('knowledge zero-hit shows a checklist, not raw JSON', async ({
    page,
  }) => {
    await page.goto('/ai-ops/quality');
    await expect(page.getByRole('heading', { name: 'AI 质量' })).toBeVisible({
      timeout: 180_000,
    });
    await waitForRole(page, 'ADMIN');
    await page.getByRole('button', { name: '知识质量' }).click();

    await page.getByPlaceholder('检索问题').fill('qa_op_no_hit_zzz_987654');
    await page.getByRole('button', { name: '检索', exact: true }).click();
    await expect(
      page.getByText('没有检索到相关文档', { exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('文档缺失：')).toBeVisible();
    await expect(
      page.getByRole('link', { name: '去知识库检查/补充文档' }),
    ).toHaveAttribute('href', /^\/knowledge\/?$/);

    const text = await page.locator('body').innerText();
    expect(text).not.toContain('"chunkId"');
    expect(text).not.toContain('"documentId"');
    await expect(page.locator('pre')).toHaveCount(0);
  });
});
