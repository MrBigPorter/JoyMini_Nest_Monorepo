/**
 * Quick Wins 1 — knowledge quality tab on /ai-ops/quality.
 *
 * Prerequisite: qa/seed/quickwins-1.ts (10 docs: 5 good, 5 flagged).
 * Expected: 文档总数 10, 有标记 5, 待复核 5 (not 0), header 上传时间.
 */
import { test, expect, waitForRole } from './fixtures';

test.describe('Quick Wins 1 — knowledge quality tab', () => {
  test.use({ role: 'ADMIN' });

  test('shows flagged/needReview counts and the upload-time column', async ({
    page,
  }) => {
    await page.goto('/ai-ops/quality');
    await expect(
      page.getByRole('heading', { name: 'AI 质量' }),
    ).toBeVisible({ timeout: 180_000 });
    await waitForRole(page, 'ADMIN');

    await page.getByRole('button', { name: '知识质量' }).click();

    const totalCard = page
      .getByText('文档总数', { exact: true })
      .locator('..');
    const flaggedCard = page
      .getByText('有标记', { exact: true })
      .locator('..');
    const needReviewCard = page
      .getByText('待复核', { exact: true })
      .locator('..');
    const excellentCard = page
      .getByText('优秀', { exact: true })
      .locator('..');
    const goodCard = page.getByText('良好', { exact: true }).locator('..');

    await expect(totalCard).toContainText('10', { timeout: 120_000 });
    await expect(flaggedCard).toContainText('5');
    await expect(needReviewCard).toContainText('5');
    await expect(needReviewCard).not.toContainText('0');
    await expect(excellentCard).toContainText('5');
    await expect(goodCard).toContainText('5');

    // Column label was corrected from 解析时间 to 上传时间.
    await expect(
      page.getByRole('columnheader', { name: '上传时间' }),
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: '解析时间' }),
    ).toHaveCount(0);

    // The 5 flagged docs are listed with truncation.
    await expect(
      page.locator('tbody tr', { hasText: 'truncation' }),
    ).toHaveCount(5, { timeout: 120_000 });
    await expect(
      page.getByText('最近标记文档', { exact: true }),
    ).toBeVisible();
  });
});
