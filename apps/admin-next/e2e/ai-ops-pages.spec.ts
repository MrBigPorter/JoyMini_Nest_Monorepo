/**
 * AI Ops smoke — page rendering & primary interactions.
 *
 * Every API call is fulfilled by ./fixtures/ai-ops; nothing touches a backend.
 * Selectors come from the current pages (test IDs, labels, visible copy).
 */
import { test, expect, dismissDevOverlay } from './fixtures/ai-ops';

test.describe('AI Ops navigation', () => {
  test('sidebar exposes the three AI Operations groups', async ({ page }) => {
    await page.goto('/ai-ops/');
    await expect(
      page.getByRole('heading', { name: '今日运营' }),
    ).toBeVisible({ timeout: 20_000 });

    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByText('AI Operations · 今日')).toBeVisible();
    await expect(sidebar.getByText('AI Operations · 业务')).toBeVisible();
    await expect(sidebar.getByText('AI Operations · 工程')).toBeVisible();

    // Each group links to its pages (href-based, locale independent).
    // trailingSlash renders "/ai-ops/quality/" in the DOM, so match by prefix.
    await expect(
      sidebar.locator('a[href^="/ai-ops/quality"]'),
    ).toBeVisible();
    await expect(
      sidebar.locator('a[href^="/ai-ops/support"]'),
    ).toBeVisible();
    await expect(
      sidebar.locator('a[href^="/ai-ops/context"]'),
    ).toBeVisible();
  });
});

test.describe('AI Ops navigation — VIEWER', () => {
  test.use({ role: 'VIEWER' });

  test('hides the engineering group but keeps business pages', async ({
    page,
  }) => {
    await page.goto('/ai-ops/');
    await expect(
      page.getByRole('heading', { name: '今日运营' }),
    ).toBeVisible({ timeout: 20_000 });

    const sidebar = page.locator('aside').first();
    await expect(sidebar.getByText('AI Operations · 工程')).toHaveCount(0);
    await expect(sidebar.getByText('AI Operations · 业务')).toBeVisible();
    await expect(
      sidebar.locator('a[href^="/ai-ops/quality"]'),
    ).toBeVisible();
  });
});

test.describe('AI Ops overview — anomaly cards', () => {
  test('renders attention section and all anomaly cards', async ({ page }) => {
    await page.goto('/ai-ops/');
    await expect(
      page.getByRole('heading', { name: '今日运营' }),
    ).toBeVisible({ timeout: 20_000 });

    const attention = page.getByTestId('attention-section');
    await expect(attention).toBeVisible();

    // Derived from mocked feedback / SLA / security summaries.
    await expect(attention).toContainText('待处理反馈');
    await expect(attention).toContainText('SLA 超时');
    await expect(attention).toContainText('安全待处理');

    for (const testId of [
      'anomaly-pending-feedback',
      'anomaly-model-error',
      'anomaly-service-error',
      'anomaly-unexpected-transfer',
      'anomaly-added-to-eval',
      'anomaly-security',
      'anomaly-sla-waiting',
      'anomaly-sla-breached',
    ]) {
      await expect(page.getByTestId(testId)).toBeVisible();
    }

    // Mocked pending feedback count is 1.
    await expect(
      page.getByTestId('anomaly-pending-feedback'),
    ).toContainText('1');
  });
});

test.describe('AI Ops quality — tabs & review card', () => {
  test('switches tabs and opens the one-at-a-time review card', async ({
    page,
  }) => {
    await page.goto('/ai-ops/quality/');
    await expect(
      page.getByRole('heading', { name: 'AI 质量' }),
    ).toBeVisible({ timeout: 20_000 });

    // Three tabs.
    await expect(
      page.getByRole('button', { name: '质量待办' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '回归测试' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '知识质量' }),
    ).toBeVisible();

    // Feedback panel: filters + mocked row + triage card (role loaded async).
    await expect(page.getByLabel('反馈分诊状态')).toBeVisible();
    await expect(page.getByText('What is the refund policy?')).toBeVisible();
    await expect(page.getByText('分诊归因')).toBeVisible({
      timeout: 20_000,
    });

    await dismissDevOverlay(page);
    await page.getByRole('button', { name: '开始质检' }).click();
    await expect(page.getByText('这条怎么处理？')).toBeVisible();
    await expect(
      page.getByText('用户问题', { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText('AI 回答', { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '回答正确' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '确认问题' }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '排除' }).first(),
    ).toBeVisible();

    // Tab switching renders the other panels.
    await page.getByRole('button', { name: '回归测试' }).click();
    await expect(page.getByPlaceholder('评测集名称')).toBeVisible();

    await page.getByRole('button', { name: '知识质量' }).click();
    await expect(page.getByPlaceholder('检索问题')).toBeVisible();
  });

  test('KPI card opens a filtered URL and survives reload', async ({
    page,
  }) => {
    await page.goto('/ai-ops/quality/');
    await expect(
      page.getByRole('heading', { name: 'AI 质量' }),
    ).toBeVisible({ timeout: 20_000 });

    await dismissDevOverlay(page);
    await page
      .getByRole('link', { name: '服务故障，查看对应反馈' })
      .click();

    await expect(page).toHaveURL(/failureKind=SERVICE_ERROR/);
    await page.reload();
    await expect(page).toHaveURL(/failureKind=SERVICE_ERROR/);
  });
});

test.describe('AI Ops support — queue & actions', () => {
  test('shows the SLA queue and can claim a mocked conversation', async ({
    page,
  }) => {
    await page.goto('/ai-ops/support/');
    await expect(
      page.getByRole('heading', { name: '转人工队列' }),
    ).toBeVisible({ timeout: 20_000 });

    await expect(page.getByText('等待中的会话')).toBeVisible();
    await expect(page.getByText('conv-sla-1')).toBeVisible();
    await expect(page.getByText('超 SLA').first()).toBeVisible();

    const claimButton = page.getByRole('button', { name: '认领' });
    await expect(claimButton).toBeEnabled({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: '关闭' })).toBeEnabled();

    // Claim is a mocked POST; the confirm dialog is accepted automatically.
    page.once('dialog', (dialog) => void dialog.accept());
    await dismissDevOverlay(page);
    await claimButton.click();

    await expect(page.getByRole('status')).toContainText(
      '已认领会话 conv-sla-1',
      { timeout: 20_000 },
    );
  });
});

test.describe('AI Ops security — status filter & triage', () => {
  test('filters events by status and records a triage action', async ({
    page,
    api,
  }) => {
    await page.goto('/ai-ops/security/');
    await expect(
      page.getByRole('heading', { name: '安全事件' }),
    ).toBeVisible({ timeout: 20_000 });

    // Summary + event row come from mocks.
    await expect(page.getByText('conv-security-1')).toBeVisible();
    await expect(page.getByText('Total hits')).toBeVisible();
    await expect(page.getByText('指令覆盖/越狱: 2')).toBeVisible();

    // Status filter drives a new request with status=NEW.
    await page.getByLabel('Security status').selectOption('NEW');
    await expect
      .poll(
        () =>
          api
            .forPath('/v1/admin/ai-security/events')
            .some((r) => r.search.get('status') === 'NEW'),
        { timeout: 10_000 },
      )
      .toBe(true);

    // Triage buttons appear once the mocked ADMIN role is loaded.
    const confirmButton = page.getByRole('button', { name: '确认攻击' });
    await expect(confirmButton).toBeVisible({ timeout: 20_000 });

    // prompt + confirm are both accepted; PATCH is fulfilled by the mock.
    const dialogHandler = (dialog: import('@playwright/test').Dialog) => {
      void dialog.accept('looks malicious');
    };
    page.on('dialog', dialogHandler);
    try {
      await dismissDevOverlay(page);
      await confirmButton.click();
      await expect
        .poll(
          () =>
            api.requests.some(
              (r) =>
                r.method === 'PATCH' &&
                r.path === '/v1/admin/ai-security/events/security-1',
            ),
          { timeout: 10_000 },
        )
        .toBe(true);
    } finally {
      page.off('dialog', dialogHandler);
    }
  });
});

test.describe('AI Ops context — readable sections', () => {
  test('renders overview, flow, context, pending confirm and messages', async ({
    page,
  }) => {
    await page.goto('/ai-ops/context/?conversationId=conv-context-1');

    await expect(
      page.getByRole('heading', { name: '会话上下文' }),
    ).toBeVisible({ timeout: 20_000 });

    await expect(page.getByText('会话概览')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText('流程状态 flowState')).toBeVisible();
    await expect(page.getByText('对话上下文 contextState')).toBeVisible();
    await expect(page.getByText('待确认操作 pendingConfirm')).toBeVisible();
    await expect(page.getByText('最近消息（2）')).toBeVisible();

    // Mocked values are surfaced as readable text.
    await expect(
      page.getByText('Order #1001', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('create_order', { exact: true })).toBeVisible();
    await expect(
      page.getByText('I want to order a blue shirt', { exact: true }),
    ).toBeVisible();
  });
});
