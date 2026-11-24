/**
 * AI Ops smoke — authentication & route guard.
 *
 * No real credentials are used. There is no safe seeded test login for the
 * admin panel, so these specs verify:
 *   - the login page renders (unauthenticated context)
 *   - protected routes redirect to /login without a session
 *   - a throwaway, structurally valid JWT cookie passes the middleware and
 *     lets mocked AI Ops pages render
 */
import { test, expect } from './fixtures/ai-ops';

test.describe('AI Ops smoke — unauthenticated', () => {
  test.use({ authenticated: false });

  test('login page renders username / password / sign in', async ({ page }) => {
    // domcontentloaded: the login page may pull optional 3rd-party scripts
    // (reCAPTCHA) that the hermetic route guard aborts, so avoid waiting on load.
    await page.goto('/login/', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByLabel('Username')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('protected AI Ops route redirects to login', async ({ page }) => {
    await page.goto('/ai-ops/');
    await page.waitForURL(/\/login/, { timeout: 20_000 });
    expect(new URL(page.url()).pathname.replace(/\/$/, '')).toBe('/login');
  });
});

test.describe('AI Ops smoke — mocked admin session', () => {
  test('fake-but-valid session cookie opens the overview', async ({ page }) => {
    await page.goto('/ai-ops/');

    // Must NOT be bounced to /login.
    await page.waitForURL(/\/ai-ops/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: '今日运营' })).toBeVisible({
      timeout: 20_000,
    });
  });
});
