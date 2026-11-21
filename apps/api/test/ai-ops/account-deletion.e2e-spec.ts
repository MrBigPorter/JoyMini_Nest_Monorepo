/**
 * Account deletion cascade + privacy policy content.
 *
 * Service-level: instantiate the real client AuthService with Prisma and call
 * clearUserData. Verifies AI lineage/memory/message/membership cleanup, orphan
 * conversation deletion, shared-conversation preservation, soft delete, and
 * financial/KYC preservation.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { AuthService } from '@api/client/auth/auth.service';

const QA_ENV_FILE = path.resolve(__dirname, '../../../../qa/.env.qa');
function loadQaEnv(): void {
  if (!fs.existsSync(QA_ENV_FILE)) return;
  for (const line of fs.readFileSync(QA_ENV_FILE, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    process.env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
}
loadQaEnv();

const QA = 'qa_del_';
const prisma = new PrismaService();
// clearUserData only uses prisma/logger; the other deps are unused here.
const auth = new AuthService(prisma, {} as never, {} as never, {} as never);

async function cleanup() {
  await prisma.order.deleteMany({
    where: { orderNo: { startsWith: QA } },
  });
  await prisma.treasure.deleteMany({
    where: { treasureId: { startsWith: QA } },
  });
  await prisma.userWallet.deleteMany({
    where: { userId: { startsWith: QA } },
  });
  await prisma.kycRecord.deleteMany({ where: { id: { startsWith: QA } } });
  await prisma.chatMessage.deleteMany({ where: { id: { startsWith: QA } } });
  await prisma.chatMember.deleteMany({
    where: {
      OR: [
        { conversationId: { startsWith: QA } },
        { userId: { startsWith: QA } },
      ],
    },
  });
  await prisma.conversation.deleteMany({
    where: { id: { startsWith: QA } },
  });
  await prisma.user.deleteMany({ where: { id: { startsWith: QA } } });
  await prisma.aiSpan.deleteMany({
    where: {
      OR: [
        { id: { startsWith: QA } },
        { traceId: { startsWith: QA } },
      ],
    },
  });
  await prisma.aiTrace.deleteMany({ where: { id: { startsWith: QA } } });
  await prisma.aiScore.deleteMany({ where: { id: { startsWith: QA } } });
  await prisma.aiAnswerFeedback.deleteMany({
    where: { id: { startsWith: QA } },
  });
  await prisma.aiUserMemory.deleteMany({ where: { id: { startsWith: QA } } });
  await prisma.aiMemorySummary.deleteMany({
    where: { id: { startsWith: QA } },
  });
}

async function seed() {
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600_000);

  await prisma.user.createMany({
    data: [
      {
        id: `${QA}user`,
        nickname: 'QA Delete User',
        phone: 'qa-del-user-phone',
        phoneMd5: 'qa_del_user_md5_000000000000',
        status: 1,
      },
      {
        id: `${QA}other`,
        nickname: 'QA Other User',
        phone: 'qa-del-other-phone',
        phoneMd5: 'qa_del_other_md5_00000000000',
        status: 1,
      },
    ],
  });

  // Financial / KYC records that must survive.
  await prisma.userWallet.create({
    data: { userId: `${QA}user`, realBalance: 12.34, coinBalance: 5 },
  });
  await prisma.kycRecord.create({
    data: {
      id: `${QA}kyc`,
      userId: `${QA}user`,
      kycStatus: 4,
      idType: 1,
      idNumber: 'qa_del_id_number',
      realName: 'QA Delete User',
    },
  });
  await prisma.treasure.create({
    data: {
      treasureId: `${QA}treasure`,
      treasureName: 'QA Delete Treasure',
      unitAmount: 1,
    },
  });
  await prisma.order.create({
    data: {
      orderNo: `${QA}order_no`,
      userId: `${QA}user`,
      treasureId: `${QA}treasure`,
      originalAmount: 1,
      discountAmount: 0,
      couponAmount: 0,
      coinAmount: 0,
      finalAmount: 1,
      buyQuantity: 1,
      unitPrice: 1,
    },
  });

  // Exclusive + shared conversations.
  await prisma.conversation.createMany({
    data: [
      {
        id: `${QA}conv_exclusive`,
        type: 'SUPPORT',
        name: `${QA}conv_exclusive`,
        status: 1,
        lastMsgSeqId: 1,
      },
      {
        id: `${QA}conv_shared`,
        type: 'SUPPORT',
        name: `${QA}conv_shared`,
        status: 1,
        lastMsgSeqId: 2,
      },
    ],
  });
  await prisma.chatMember.createMany({
    data: [
      { conversationId: `${QA}conv_exclusive`, userId: `${QA}user`, role: 'OWNER' },
      { conversationId: `${QA}conv_shared`, userId: `${QA}user`, role: 'MEMBER' },
      { conversationId: `${QA}conv_shared`, userId: `${QA}other`, role: 'MEMBER' },
    ],
  });
  await prisma.chatMessage.createMany({
    data: [
      {
        id: `${QA}msg_exclusive`,
        conversationId: `${QA}conv_exclusive`,
        senderId: `${QA}user`,
        type: 0,
        content: 'qa_del_exclusive_message',
        seqId: 1,
        source: 'user',
      },
      {
        id: `${QA}msg_shared_user`,
        conversationId: `${QA}conv_shared`,
        senderId: `${QA}user`,
        type: 0,
        content: 'qa_del_shared_user_message',
        seqId: 1,
        source: 'user',
      },
      {
        id: `${QA}msg_shared_other`,
        conversationId: `${QA}conv_shared`,
        senderId: `${QA}other`,
        type: 0,
        content: 'qa_del_shared_other_message',
        seqId: 2,
        source: 'user',
      },
    ],
  });

  // AI lineage for the user.
  await prisma.aiTrace.create({
    data: {
      id: `${QA}trace`,
      conversationId: `${QA}conv_exclusive`,
      userId: `${QA}user`,
      source: 'qa',
      intent: 'general',
      input: 'qa_del_trace_input',
      status: 'SUCCESS',
      spans: {
        create: [
          {
            id: `${QA}span`,
            type: 'llm',
            name: 'qa-span',
            status: 'OK',
            startedAt: new Date(),
          },
        ],
      },
    },
  });
  await prisma.aiScore.createMany({
    data: [
      {
        id: `${QA}score_llm`,
        traceId: `${QA}trace`,
        conversationId: `${QA}conv_exclusive`,
        source: 'LLM',
        value: 0.5,
      },
      {
        id: `${QA}score_human`,
        traceId: `${QA}trace`,
        conversationId: `${QA}conv_exclusive`,
        source: 'HUMAN',
        value: 1,
      },
    ],
  });
  await prisma.aiAnswerFeedback.createMany({
    data: [
      {
        id: `${QA}fb_user`,
        conversationId: `${QA}conv_exclusive`,
        userId: `${QA}user`,
        source: 'explicit',
        verdict: 'incorrect',
        failureKind: 'MODEL_ERROR',
        resolution: 'OPEN',
        reviewStatus: 'PENDING',
      },
      {
        id: `${QA}fb_conv`,
        conversationId: `${QA}conv_shared`,
        source: 'implicit',
        signal: 'abandoned',
        failureKind: 'USER_ABANDONED',
        resolution: 'OPEN',
        reviewStatus: 'PENDING',
      },
    ],
  });
  await prisma.aiUserMemory.create({
    data: {
      id: `${QA}memory`,
      userId: `${QA}user`,
      kind: 'preference',
      key: 'qa_language',
      value: 'zh',
      expiresAt,
    },
  });
  await prisma.aiMemorySummary.create({
    data: {
      id: `${QA}summary`,
      userId: `${QA}user`,
      threadId: `${QA}thread`,
      conversationId: `${QA}conv_exclusive`,
      summary: 'qa_del_summary',
      expiresAt,
    },
  });
}

beforeAll(async () => {
  await cleanup();
  await seed();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('Account deletion — AI cascade + financial preservation', () => {
  it('deletes AI data/messages/memberships, keeps shared conversation and finance/KYC', async () => {
    const result = await auth.clearUserData(`${QA}user`);
    expect(result.accountDeleted).toBe(true);

    // Soft delete only; finance/KYC/tx untouched.
    const user = await prisma.user.findUnique({ where: { id: `${QA}user` } });
    expect(user?.status).toBe(0);
    expect(
      await prisma.userWallet.findUnique({ where: { userId: `${QA}user` } }),
    ).toBeTruthy();
    expect(
      await prisma.kycRecord.findUnique({ where: { id: `${QA}kyc` } }),
    ).toMatchObject({ kycStatus: 4, idNumber: 'qa_del_id_number' });
    expect(
      await prisma.order.findUnique({ where: { orderNo: `${QA}order_no` } }),
    ).toBeTruthy();

    // AI lineage, scores, feedback, memories.
    expect(await prisma.aiTrace.findUnique({ where: { id: `${QA}trace` } }))
      .toBeNull();
    expect(await prisma.aiSpan.findUnique({ where: { id: `${QA}span` } }))
      .toBeNull();
    expect(await prisma.aiScore.findUnique({ where: { id: `${QA}score_llm` } }))
      .toBeNull();
    expect(
      await prisma.aiScore.findUnique({ where: { id: `${QA}score_human` } }),
    ).toBeNull();
    expect(
      await prisma.aiAnswerFeedback.findUnique({ where: { id: `${QA}fb_user` } }),
    ).toBeNull();
    expect(
      await prisma.aiAnswerFeedback.findUnique({ where: { id: `${QA}fb_conv` } }),
    ).toBeNull();
    expect(
      await prisma.aiUserMemory.findUnique({ where: { id: `${QA}memory` } }),
    ).toBeNull();
    expect(
      await prisma.aiMemorySummary.findUnique({ where: { id: `${QA}summary` } }),
    ).toBeNull();

    // Own messages + memberships gone.
    expect(
      await prisma.chatMessage.findUnique({
        where: { id: `${QA}msg_exclusive` },
      }),
    ).toBeNull();
    expect(
      await prisma.chatMessage.findUnique({
        where: { id: `${QA}msg_shared_user` },
      }),
    ).toBeNull();
    expect(
      await prisma.chatMember.findFirst({ where: { userId: `${QA}user` } }),
    ).toBeNull();

    // Exclusive empty conversation deleted; shared conversation preserved.
    expect(
      await prisma.conversation.findUnique({
        where: { id: `${QA}conv_exclusive` },
      }),
    ).toBeNull();
    expect(
      await prisma.conversation.findUnique({
        where: { id: `${QA}conv_shared` },
      }),
    ).toBeTruthy();
    expect(
      await prisma.chatMessage.findUnique({
        where: { id: `${QA}msg_shared_other` },
      }),
    ).toBeTruthy();
    expect(
      await prisma.chatMember.findFirst({ where: { userId: `${QA}other` } }),
    ).toBeTruthy();
    // The other user is untouched.
    expect(
      (await prisma.user.findUnique({ where: { id: `${QA}other` } }))?.status,
    ).toBe(1);
  });
});

describe('Privacy policy content', () => {
  const file = path.resolve(
    __dirname,
    '../../../../apps/frontend-blog/src/lib/privacy/privacy-content.ts',
  );

  function languageBlocks(): Record<string, string> {
    const raw = fs.readFileSync(file, 'utf8');
    const blocks: Record<string, string> = {};
    const re = /^  (en|zh|ja|ko|fr|de): `([\s\S]*?)`,\s*$/gm;
    let match: RegExpExecArray | null;
    while ((match = re.exec(raw)) !== null) {
      blocks[match[1]] = match[2];
    }
    return blocks;
  }

  it('six languages disclose DeepSeek/Jina AI/Groq, 30-day traces and deletion', () => {
    const blocks = languageBlocks();
    expect(Object.keys(blocks).sort()).toEqual([
      'de',
      'en',
      'fr',
      'ja',
      'ko',
      'zh',
    ]);

    for (const [lang, text] of Object.entries(blocks)) {
      expect(text).toContain('DeepSeek');
      expect(text).toContain('Jina AI');
      expect(text).toContain('Groq');
      expect(text).toContain('30');
      // AI diagnostic traces / deletion of AI data.
      expect(text).toMatch(/trace|Trace|トレース|추적/);
      expect(text).toMatch(/delete|删除|削除|삭제|supprim|lösch/);
      // No overclaim such as "we signed a DPA".
      expect(text).not.toMatch(/signed\s+(a\s+)?DPA/i);
      expect(text).not.toMatch(/已签\s*DPA|签署\s*DPA/);
    }
  });
});
