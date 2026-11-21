/**
 * Batch 3 — feature-flag UI (quality page + ChatWindow feedback buttons).
 *
 * The spec reads the live /admin/ai-ops/features flag and asserts the UI
 * matches it. Run it once with flags true and once with flags false.
 */
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

async function getFeatures(
  request: import('@playwright/test').APIRequestContext,
): Promise<{ feedbackUiEnabled: boolean; evalEnabled: boolean }> {
  const res = await request.get(`${API_BASE}/v1/admin/ai-ops/features`, {
    headers: { Authorization: `Bearer ${tokenForRole('ADMIN')}` },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data;
}

const FEEDBACK_CORRECT_BUTTON =
  'button[title="回答正确"], button[title="Correct answer"]';
const FEEDBACK_WRONG_BUTTON =
  'button[title="回答有误"], button[title="Wrong answer"]';

test.describe('Batch 3 — feedback flag UI', () => {
  test.use({ role: 'ADMIN' });

  test('quality page and ChatWindow follow the live feedback flag', async ({
    page,
    request,
    context,
  }) => {
    // Force zh so the feedback button titles are stable.
    await context.addCookies([
      { name: 'app_locale', value: 'zh', url: 'http://127.0.0.1:4101' },
    ]);
    const features = await getFeatures(request);

    // ── Quality page ──
    const qualityFeatures = page.waitForResponse(
      (resp) =>
        resp.url().includes('/v1/admin/ai-ops/features') && resp.ok(),
    );
    await page.goto('/ai-ops/quality');
    await expect(
      page.getByRole('heading', { name: 'AI 质量' }),
    ).toBeVisible({ timeout: 180_000 });
    await waitForRole(page, 'ADMIN');
    await qualityFeatures;

    if (features.feedbackUiEnabled) {
      await expect(page.getByText('反馈分诊未启用')).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: '开始质检' }),
      ).toBeVisible({ timeout: 120_000 });
    } else {
      await expect(
        page.getByText('反馈分诊未启用').first(),
      ).toBeVisible({ timeout: 120_000 });
      await expect(
        page.getByRole('button', { name: '开始质检' }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: '确认问题' }),
      ).toHaveCount(0);
      await expect(page.getByRole('button', { name: '排除' })).toHaveCount(0);
    }

    // ── ChatWindow ──
    const chatFeatures = page.waitForResponse(
      (resp) =>
        resp.url().includes('/v1/admin/ai-ops/features') && resp.ok(),
    );
    await page.goto('/customer-service?conversationId=qa_conv_1');
    await waitForRole(page, 'ADMIN');
    await chatFeatures;

    // The seeded AI reply must be visible before judging the feedback buttons.
    await expect(page.getByText('qa_ai_answer_secret_1').first()).toBeVisible({
      timeout: 180_000,
    });

    const correctButtons = page.locator(FEEDBACK_CORRECT_BUTTON);
    const wrongButtons = page.locator(FEEDBACK_WRONG_BUTTON);

    if (features.feedbackUiEnabled) {
      await expect(correctButtons.first()).toBeVisible({ timeout: 120_000 });
      await expect(wrongButtons.first()).toBeVisible({ timeout: 120_000 });
    } else {
      await expect(correctButtons).toHaveCount(0);
      await expect(wrongButtons).toHaveCount(0);
    }
  });
});
