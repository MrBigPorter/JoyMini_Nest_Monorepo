/**
 * Chat desk — polling merge, scroll anchoring, claim paths.
 * Real admin + real API, real Postgres rows seeded by qa/seed/chat-desk.ts.
 */
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { test, expect, QA_ENV } from './fixtures';

const repoRoot = path.resolve(__dirname, '../../..');
const seedFile = path.join(repoRoot, 'qa/seed/chat-desk.ts');

function seed(args: string[]): string {
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

const deskHeading = /客服工作台|Customer Service Desk/;
const claimButton = /^(认领|Claim)$/;
const loadEarlier = /加载更早的消息|Load earlier messages/;

async function openConversation(page: import('@playwright/test').Page, id: string) {
  await page.goto(`/customer-service?conversationId=${id}`);
  await expect(page.getByRole('heading', { name: deskHeading })).toBeVisible({
    timeout: 180_000,
  });
  await expect(
    page.getByText('QA Chat Desk Customer', { exact: true }).first(),
  ).toBeVisible({ timeout: 120_000 });
}

test.describe('Chat desk polling and claims', () => {
  test.beforeAll(() => {
    seed([]);
  });

  test.afterAll(() => {
    seed(['--clean']);
  });

  test('polling merges the latest page into loaded history', async ({
    page,
  }) => {
    await openConversation(page, 'qa_cd_conv_merge');

    // First page is the 30 newest messages (seq 11–40); seq 1 is not loaded yet.
    await expect(
      page.getByText('qa_cd_merge_msg_40', { exact: true }).first(),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByText('qa_cd_merge_msg_01', { exact: true }),
    ).toHaveCount(0);

    await page.getByRole('button', { name: loadEarlier }).click();
    await expect(
      page.getByText('qa_cd_merge_msg_01', { exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    // At least one 10s poll fires; it must merge, not replace, the history.
    await page.waitForTimeout(11_500);
    await expect(
      page.getByText('qa_cd_merge_msg_01', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('qa_cd_merge_msg_40', { exact: true }).first(),
    ).toBeVisible();
  });

  test('polling does not force a scrolled-up reader to the bottom', async ({
    page,
  }) => {
    await openConversation(page, 'qa_cd_conv_merge');
    await expect(
      page.getByText('qa_cd_merge_msg_40', { exact: true }).first(),
    ).toBeVisible({ timeout: 60_000 });

    await page.getByRole('button', { name: loadEarlier }).click();
    await expect(
      page.getByText('qa_cd_merge_msg_01', { exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    // The dashboard <main> is the real scroll container in this layout.
    const scroller = page.locator('main');
    await scroller.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(300);

    const before = await scroller.evaluate((el) => ({
      scrollTop: el.scrollTop,
      distanceFromBottom:
        el.scrollHeight - el.scrollTop - el.clientHeight,
    }));
    expect(before.scrollTop).toBeLessThan(50);
    expect(before.distanceFromBottom).toBeGreaterThan(100);

    await page.waitForTimeout(11_500);

    const after = await scroller.evaluate((el) => ({
      scrollTop: el.scrollTop,
      distanceFromBottom:
        el.scrollHeight - el.scrollTop - el.clientHeight,
    }));
    // The poll must not scroll the reader back to the bottom.
    expect(after.scrollTop).toBeLessThan(50);
    expect(after.distanceFromBottom).toBeGreaterThan(100);
  });

  test('claim success assigns the conversation to the current agent', async ({
    page,
  }) => {
    await openConversation(page, 'qa_cd_conv_claim');

    const claimResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/conversations/qa_cd_conv_claim/claim'),
    );
    await page.getByRole('button', { name: claimButton }).click();
    const response = await claimResponse;
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect((body.data ?? body).handlerId).toBe('qa_admin_admin');

    // Once claimed, the awaiting-human claim button disappears.
    await expect(
      page.getByRole('button', { name: claimButton }),
    ).toHaveCount(0);
  });

  test('claim conflict (409) surfaces an error toast', async ({ page }) => {
    await openConversation(page, 'qa_cd_conv_conflict');

    // Another agent wins the race between render and click.
    seed(['set', 'qa_cd_conv_conflict', 'qa_admin_admin']);

    const claimResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/conversations/qa_cd_conv_conflict/claim'),
    );
    await page.getByRole('button', { name: claimButton }).click();
    const response = await claimResponse;
    expect(response.status()).toBe(409);

    await expect(
      page.getByText('会话已被其他客服认领，列表已刷新', { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('awaiting_human Human button claims instead of switching handler', async ({
    page,
    requests,
  }) => {
    await openConversation(page, 'qa_cd_conv_human');

    const claimResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/conversations/qa_cd_conv_human/claim'),
    );
    await page.getByRole('button', { name: /Human/ }).click();
    const response = await claimResponse;
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect((body.data ?? body).handlerId).toBe('qa_admin_admin');

    // Must NOT fall through to PATCH /handler (which would send it back to AI).
    const handlerSwitches = requests.filter(
      (request) =>
        request.method === 'PATCH' &&
        request.url.pathname.endsWith('/handler'),
    );
    expect(handlerSwitches).toEqual([]);
    expect(
      requests.filter(
        (request) =>
          request.method === 'POST' &&
          request.url.pathname.endsWith('/claim'),
      ).length,
    ).toBeGreaterThanOrEqual(1);
  });
});
