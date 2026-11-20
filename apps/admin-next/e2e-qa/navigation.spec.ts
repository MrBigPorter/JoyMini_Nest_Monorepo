/**
 * Batch 1 — role-aware navigation, real admin + real API.
 */
import { test, expect, waitForRole } from './fixtures';

test.describe('VIEWER navigation', () => {
  test.use({ role: 'VIEWER' });

  test('sidebar hides the whole "AI Operations · 工程" group', async ({
    page,
  }) => {
    await page.goto('/ai-ops/');
    await expect(
      page.getByRole('heading', { name: '今日运营' }),
    ).toBeVisible({ timeout: 180_000 });
    await waitForRole(page, 'VIEWER');

    const sidebar = page.locator('aside');
    await expect(
      sidebar.getByText('AI Operations · 今日', { exact: true }),
    ).toBeVisible();
    await expect(
      sidebar.getByText('AI Operations · 业务', { exact: true }),
    ).toBeVisible();
    await expect(
      sidebar.getByText('AI Operations · 工程', { exact: true }),
    ).toHaveCount(0);

    for (const href of [
      '/ai-ops/runtime',
      '/ai-ops/flows',
      '/ai-ops/usage',
      '/ai-ops/memory',
      '/ai-ops/security',
      '/ai-ops/context',
      '/ai-ops/traces',
    ]) {
      await expect(sidebar.locator(`a[href^="${href}"]`)).toHaveCount(0);
    }

    // D-03 regression: the overview "快速入口" must follow the same role rule.
    const quickEntry = page
      .getByRole('heading', { name: '快速入口' })
      .locator('..');
    const quickHrefs = await quickEntry
      .locator('a')
      .evaluateAll((links) =>
        links.map((link) => link.getAttribute('href') ?? ''),
      );
    expect(quickHrefs.sort()).toEqual(
      [
        '/ai-ops/insights/',
        '/ai-ops/quality/',
        '/ai-ops/support/',
      ].sort(),
    );
    for (const href of [
      '/ai-ops/runtime',
      '/ai-ops/flows',
      '/ai-ops/usage',
      '/ai-ops/memory',
      '/ai-ops/security',
    ]) {
      await expect(quickEntry.locator(`a[href^="${href}"]`)).toHaveCount(0);
    }

    // D-04: no engineering href anywhere on the overview for VIEWER.
    await expect(
      page.locator(
        'a[href^="/ai-ops/runtime"], a[href^="/ai-ops/flows"], ' +
          'a[href^="/ai-ops/usage"], a[href^="/ai-ops/memory"], ' +
          'a[href^="/ai-ops/security"]',
      ),
    ).toHaveCount(0);

    // The stat cards still render their values; they are just not links.
    for (const label of [
      'AI 队列等待',
      'AI 死信',
      'Outbox 失败',
      '今日 Token（UTC）',
      'RAG 向量队列',
    ]) {
      const card = page.getByText(label, { exact: true }).locator('..');
      await expect(card).toBeVisible();
      await expect(card).toContainText(/[0-9]/, { timeout: 120_000 });
      expect(await card.evaluate((el) => el.tagName)).not.toBe('A');
    }

    // Security anomaly card still shows the count, but is not a link.
    const securityCard = page.getByTestId('anomaly-security');
    await expect(securityCard).toBeVisible();
    await expect(securityCard).toContainText('1 / 1', { timeout: 120_000 });
    expect(await securityCard.evaluate((el) => el.tagName)).not.toBe('A');

    // The "安全待处理" attention row is not rendered for VIEWER at all.
    await expect(page.getByText('安全待处理', { exact: true })).toHaveCount(0);
  });
});

test.describe('ADMIN navigation', () => {
  test.use({ role: 'ADMIN' });

  test('sidebar shows the engineering group and its links', async ({
    page,
  }) => {
    await page.goto('/ai-ops/');
    await expect(
      page.getByRole('heading', { name: '今日运营' }),
    ).toBeVisible({ timeout: 180_000 });
    await waitForRole(page, 'ADMIN');

    const sidebar = page.locator('aside');
    await expect(
      sidebar.getByText('AI Operations · 工程', { exact: true }),
    ).toBeVisible();
    for (const href of [
      '/ai-ops/runtime',
      '/ai-ops/traces',
      '/ai-ops/security',
      '/ai-ops/context',
    ]) {
      await expect(sidebar.locator(`a[href^="${href}"]`)).toHaveCount(1);
    }

    // D-03 regression: ADMIN keeps all 8 quick entries, including engineering.
    const quickEntry = page
      .getByRole('heading', { name: '快速入口' })
      .locator('..');
    await expect(quickEntry.locator('a')).toHaveCount(8, { timeout: 120_000 });
    for (const href of [
      '/ai-ops/runtime',
      '/ai-ops/flows',
      '/ai-ops/usage',
      '/ai-ops/memory',
      '/ai-ops/security',
      '/ai-ops/quality',
      '/ai-ops/support',
      '/ai-ops/insights',
    ]) {
      await expect(quickEntry.locator(`a[href^="${href}"]`)).toHaveCount(1);
    }

    // D-04: the engineering stat cards are clickable again for ADMIN.
    const assertCardLink = async (label: string, href: string) => {
      const card = page.getByText(label, { exact: true }).locator('..');
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute('href', href, { timeout: 120_000 });
      expect(await card.evaluate((el) => el.tagName)).toBe('A');
    };
    await assertCardLink('AI 队列等待', '/ai-ops/runtime/');
    await assertCardLink('AI 死信', '/ai-ops/runtime/');
    await assertCardLink('Outbox 失败', '/ai-ops/runtime/');
    await assertCardLink('今日 Token（UTC）', '/ai-ops/usage/');
    await assertCardLink('RAG 向量队列', '/ai-ops/runtime/');

    const securityCard = page.getByTestId('anomaly-security');
    await expect(securityCard).toHaveAttribute('href', '/ai-ops/security/');
    await expect(securityCard).toContainText('1 / 1', { timeout: 120_000 });
    await expect(
      page.getByRole('link', { name: /安全待处理/ }),
    ).toHaveAttribute('href', '/ai-ops/security/');
  });
});

test.describe('SUPER_ADMIN navigation', () => {
  test.use({ role: 'SUPER_ADMIN' });

  test('sidebar and quick entries keep the engineering group', async ({
    page,
  }) => {
    await page.goto('/ai-ops/');
    await expect(
      page.getByRole('heading', { name: '今日运营' }),
    ).toBeVisible({ timeout: 180_000 });
    await waitForRole(page, 'SUPER_ADMIN');

    const sidebar = page.locator('aside');
    await expect(
      sidebar.getByText('AI Operations · 工程', { exact: true }),
    ).toBeVisible();

    const quickEntry = page
      .getByRole('heading', { name: '快速入口' })
      .locator('..');
    await expect(quickEntry.locator('a')).toHaveCount(8, { timeout: 120_000 });
    for (const href of [
      '/ai-ops/runtime',
      '/ai-ops/flows',
      '/ai-ops/usage',
      '/ai-ops/memory',
      '/ai-ops/security',
    ]) {
      await expect(quickEntry.locator(`a[href^="${href}"]`)).toHaveCount(1);
    }

    // D-04: engineering stat cards remain clickable for SUPER_ADMIN.
    const runtimeCard = page
      .getByText('AI 队列等待', { exact: true })
      .locator('..');
    await expect(runtimeCard).toHaveAttribute('href', '/ai-ops/runtime/', {
      timeout: 120_000,
    });
    const usageCard = page
      .getByText('今日 Token（UTC）', { exact: true })
      .locator('..');
    await expect(usageCard).toHaveAttribute('href', '/ai-ops/usage/', {
      timeout: 120_000,
    });
    const securityCard = page.getByTestId('anomaly-security');
    await expect(securityCard).toHaveAttribute('href', '/ai-ops/security/');
    await expect(
      page.getByRole('link', { name: /安全待处理/ }),
    ).toHaveAttribute('href', '/ai-ops/security/');
  });
});
