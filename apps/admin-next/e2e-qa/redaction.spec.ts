/**
 * Batch 1 — real-endpoint redaction seen through the admin UI.
 *
 * The API contract suite proves the payload is null for VIEWER; this spec
 * proves the rendered page never shows the seeded raw text and does show it
 * for ADMIN.
 */
import { test, expect, waitForRole } from './fixtures';

const SECRETS = [
  'qa_trace_input_secret',
  'qa_trace_output_secret',
  'qa_span_input_secret',
  'qa_span_output_secret',
  'qa_span_error_secret',
];

async function openFirstTraceDetail(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.goto('/ai-ops/traces/');
  await expect(
    page.getByRole('heading', { name: '链路追踪' }),
  ).toBeVisible({ timeout: 180_000 });
  await page.getByRole('button', { name: '详情' }).first().click();
  await expect(page.getByText('用户输入（截断）')).toBeVisible({
    timeout: 120_000,
  });
}

test.describe('VIEWER trace detail redaction (UI)', () => {
  test.use({ role: 'VIEWER' });

  test('placeholder is shown and no raw secret reaches the DOM', async ({
    page,
  }) => {
    await openFirstTraceDetail(page);
    await waitForRole(page, 'VIEWER');

    await expect(
      page.getByText('只读账号不显示原文').first(),
    ).toBeVisible();

    const body = await page.locator('body').innerText();
    for (const secret of SECRETS) {
      expect(body).not.toContain(secret);
    }
  });
});

test.describe('ADMIN trace detail keeps raw text (UI)', () => {
  test.use({ role: 'ADMIN' });

  test('raw input/output are visible to ADMIN', async ({ page }) => {
    await openFirstTraceDetail(page);
    await waitForRole(page, 'ADMIN');

    const body = await page.locator('body').innerText();
    expect(body).toContain('qa_trace_input_secret');
    expect(body).toContain('qa_trace_output_secret');
  });
});
