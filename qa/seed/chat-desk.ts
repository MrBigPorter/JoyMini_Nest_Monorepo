/**
 * Chat desk QA seed — polling merge, scroll anchoring, claim paths.
 *
 * Conversations (all SUPPORT, status NORMAL):
 *   qa_cd_conv_merge    40 messages, handler = AI (null)
 *   qa_cd_conv_claim    awaiting_human, 2 messages
 *   qa_cd_conv_conflict awaiting_human, 2 messages (test flips it to an agent)
 *   qa_cd_conv_human    awaiting_human, 2 messages (Human button path)
 *
 * Run:
 *   DATABASE_URL=... npx tsx qa/seed/chat-desk.ts
 *   DATABASE_URL=... npx tsx qa/seed/chat-desk.ts --clean
 *   DATABASE_URL=... npx tsx qa/seed/chat-desk.ts set <convId> <handlerId>
 *   DATABASE_URL=... npx tsx qa/seed/chat-desk.ts get <convId>
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const PREFIX = 'qa_cd_';

async function clean() {
  await prisma.chatMessage.deleteMany({
    where: {
      OR: [
        { id: { startsWith: PREFIX } },
        { conversationId: { startsWith: PREFIX } },
      ],
    },
  });
  await prisma.chatMember.deleteMany({
    where: {
      OR: [
        { conversationId: { startsWith: PREFIX } },
        { userId: { startsWith: PREFIX } },
      ],
    },
  });
  await prisma.conversation.deleteMany({
    where: { id: { startsWith: PREFIX } },
  });
  await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

async function seed() {
  const now = Date.now();
  const at = (offsetSeconds: number) => new Date(now + offsetSeconds * 1000);

  await prisma.user.upsert({
    where: { id: `${PREFIX}user` },
    update: { nickname: 'QA Chat Desk Customer' },
    create: {
      id: `${PREFIX}user`,
      nickname: 'QA Chat Desk Customer',
      phone: 'qa-cd-customer-phone',
      phoneMd5: 'qa_cd_customer_md5_000000000000',
      isRobot: false,
    },
  });

  const conversations = [
    {
      id: `${PREFIX}conv_merge`,
      lastMsgSeqId: 40,
      lastMsgContent: `${PREFIX}merge_msg_40`,
      lastMsgTime: at(0),
      handlerId: null,
    },
    {
      id: `${PREFIX}conv_claim`,
      lastMsgSeqId: 2,
      lastMsgContent: `${PREFIX}claim_msg_2`,
      lastMsgTime: at(1),
      handlerId: 'awaiting_human',
    },
    {
      id: `${PREFIX}conv_conflict`,
      lastMsgSeqId: 2,
      lastMsgContent: `${PREFIX}conflict_msg_2`,
      lastMsgTime: at(2),
      handlerId: 'awaiting_human',
    },
    {
      id: `${PREFIX}conv_human`,
      lastMsgSeqId: 2,
      lastMsgContent: `${PREFIX}human_msg_2`,
      lastMsgTime: at(3),
      handlerId: 'awaiting_human',
    },
  ];

  for (const conv of conversations) {
    await prisma.conversation.upsert({
      where: { id: conv.id },
      update: {
        lastMsgSeqId: conv.lastMsgSeqId,
        lastMsgContent: conv.lastMsgContent,
        lastMsgTime: conv.lastMsgTime,
        handlerId: conv.handlerId,
        transferReason:
          conv.handlerId === 'awaiting_human' ? 'explicit_request' : null,
        transferredAt:
          conv.handlerId === 'awaiting_human' ? at(-120) : null,
        handlerAssignedAt: null,
        status: 1,
      },
      create: {
        id: conv.id,
        type: 'SUPPORT',
        name: conv.id,
        status: 1,
        lastMsgSeqId: conv.lastMsgSeqId,
        lastMsgContent: conv.lastMsgContent,
        lastMsgTime: conv.lastMsgTime,
        handlerId: conv.handlerId,
        transferReason:
          conv.handlerId === 'awaiting_human' ? 'explicit_request' : null,
        transferredAt:
          conv.handlerId === 'awaiting_human' ? at(-120) : null,
      },
    });
  }

  await prisma.chatMember.createMany({
    data: conversations.map((conv) => ({
      conversationId: conv.id,
      userId: `${PREFIX}user`,
      role: 'OWNER',
      lastReadSeqId: 0,
    })),
    skipDuplicates: true,
  });

  const messages: Array<{
    id: string;
    conversationId: string;
    senderId: string | null;
    type: number;
    content: string;
    seqId: number;
    role: string;
    source: string;
    createdAt: Date;
  }> = [];

  // Merge conversation: 40 messages so the first page (30) misses seq 1–10.
  for (let seq = 1; seq <= 40; seq += 1) {
    const suffix = String(seq).padStart(2, '0');
    messages.push({
      id: `${PREFIX}merge_msg_${suffix}`,
      conversationId: `${PREFIX}conv_merge`,
      senderId: seq % 2 === 0 ? null : `${PREFIX}user`,
      type: 0,
      content: `${PREFIX}merge_msg_${suffix}`,
      seqId: seq,
      role: seq % 2 === 0 ? 'assistant' : 'user',
      source: seq % 2 === 0 ? 'ai' : 'user',
      createdAt: at(-40 + seq),
    });
  }

  for (const name of ['claim', 'conflict', 'human'] as const) {
    for (let seq = 1; seq <= 2; seq += 1) {
      messages.push({
        id: `${PREFIX}${name}_msg_${seq}`,
        conversationId: `${PREFIX}conv_${name}`,
        senderId: `${PREFIX}user`,
        type: 0,
        content: `${PREFIX}${name}_msg_${seq}`,
        seqId: seq,
        role: 'user',
        source: 'user',
        createdAt: at(-10 + seq),
      });
    }
  }

  await prisma.chatMessage.createMany({ data: messages, skipDuplicates: true });
}

async function main() {
  const [, , command, arg1, arg2] = process.argv;

  if (command === 'set') {
    if (!arg1 || !arg2) throw new Error('usage: set <convId> <handlerId>');
    const updated = await prisma.conversation.update({
      where: { id: arg1 },
      data: {
        handlerId: arg2 === 'null' ? null : arg2,
        handlerAssignedAt: arg2 === 'null' ? null : new Date(),
      },
      select: { id: true, handlerId: true },
    });
    console.log(JSON.stringify(updated));
    return;
  }

  if (command === 'get') {
    if (!arg1) throw new Error('usage: get <convId>');
    const conv = await prisma.conversation.findUnique({
      where: { id: arg1 },
      select: { id: true, handlerId: true, status: true, lastMsgSeqId: true },
    });
    console.log(JSON.stringify(conv));
    return;
  }

  await clean();
  if (command !== '--clean') await seed();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
