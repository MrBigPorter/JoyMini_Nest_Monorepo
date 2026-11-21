/**
 * Insights metrics page QA (commit 42ee6d76 / 301cff59).
 *
 * Uses qa/seed/insights-metrics.ts for UTC 2026-11-15:
 *   conversations 2; transfer 2/3=66.7%; modelError 2/3; serviceError 2/4;
 *   misTransfer 1/4; suspectedMisTransfer 5.
 */
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { test, expect, waitForRole, QA_ENV } from './fixtures';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const D = '2026-11-15';

function runSeed(args: string): void {
  execSync(`npx tsx qa/seed/insights-metrics.ts ${args}`, {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: QA_ENV.DATABASE_URL },
    stdio: 'pipe',
    timeout: 120_000,
  });
}

test.beforeAll(() => runSeed(''));
test.afterAll(() => runSeed('--clean'));

function card(page: import('@playwright/test').Page, label: string) {
  return page.getByText(label, { exact: true }).locator('..');
}

test.describe('Insights metrics page', () => {
  test.use({ role: 'ADMIN' });

  test('Chinese labels, fractions and rates for the D window', async ({
    page,
  }) => {
    await page.goto('/ai-ops/insights');
    await expect(
      page.getByRole('heading', { name: '运营洞察' }),
    ).toBeVisible({ timeout: 180_000 });
    await waitForRole(page, 'ADMIN');

    await page.getByLabel('From date').fill(D);
    await page.getByLabel('To date').fill(D);

    const labels = [
      '会话数',
      'AI 消息',
      '转人工率',
      '模型错误率',
      '服务故障率',
      '误转率',
      '重复追问',
      '用户放弃',
      '人工消息（客服回复）',
      '疑似误转（信号区）',
      'Token 用量',
      '请求数',
    ];
    for (const label of labels) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible({
        timeout: 120_000,
      });
    }

    await expect(card(page, '会话数')).toContainText('2');
    await expect(card(page, '转人工率')).toContainText('66.7% (2/3)', {
      timeout: 120_000,
    });
    await expect(card(page, '转人工率')).toContainText(
      '分母 = 窗口内创建或转人工的 SUPPORT/AI 会话',
    );
    await expect(card(page, '模型错误率')).toContainText('66.7%');
    await expect(card(page, '模型错误率')).toContainText(
      '分子/分母：2 / 3',
    );
    await expect(card(page, '服务故障率')).toContainText('50.0%');
    await expect(card(page, '服务故障率')).toContainText(
      '分子/分母：2 / 4',
    );
    await expect(card(page, '误转率')).toContainText('25.0%');
    await expect(card(page, '误转率')).toContainText('分子/分母：1 / 4');
    await expect(card(page, '疑似误转（信号区）')).toContainText('5');
  });
});
