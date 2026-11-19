#!/usr/bin/env node
/**
 * 会话内消息序号并发验证（agent-trust-boundary 5.4）
 *
 * 用真实 Socket 入口同时发送两条消息：
 *   - 两条都必须落库
 *   - seqId 必须不同（数据库唯一索引兜底）
 *
 * 为避免触发 AI/LLM，脚本临时把目标会话 handler_id 置为 'seq-e2e'，
 * 结束后恢复；测试消息按内容前缀删除。
 *
 * 前置：本地 docker compose 的 backend/nginx/db 在运行。
 * 用法：node scripts/e2e-message-seq.js
 */
const { execFileSync } = require('node:child_process');
const { io } = require('socket.io-client');

const MARKER = `__SEQ_E2E_${Date.now()}__`;

function psql(sql) {
  return execFileSync(
    'docker',
    [
      'exec',
      'lucky-db',
      'sh',
      '-lc',
      `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F "|" -c "${sql.replace(/"/g, '\\"')}"`,
    ],
    { encoding: 'utf8' },
  ).trim();
}

function signToken(userId) {
  return execFileSync(
    'docker',
    [
      'exec',
      '-w',
      '/app/apps/api',
      'lucky-backend-dev',
      'node',
      '-e',
      `const jwt=require('jsonwebtoken');process.stdout.write(jwt.sign({sub:'${userId}',type:'access'},process.env.JWT_SECRET||'please_change_me_very_secret',{expiresIn:'5m'}))`,
    ],
    { encoding: 'utf8' },
  );
}

function emit(socket, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ack timeout')), 15_000);
    socket.emit('send_message', payload, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

async function main() {
  const [conversationId, userId] = psql(
    'select c.id, m."userId" from "Conversation" c join "ChatMember" m on m."conversationId"=c.id limit 1',
  ).split('|');
  if (!conversationId || !userId) throw new Error('no conversation/member');

  const oldHandler = psql(
    `select coalesce(handler_id,'') from "Conversation" where id='${conversationId}'`,
  );
  psql(`update "Conversation" set handler_id='seq-e2e' where id='${conversationId}'`);

  const socket = io('http://localhost/events', {
    auth: { token: signToken(userId) },
    transports: ['websocket'],
  });

  try {
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });

    const [a, b] = await Promise.all([
      emit(socket, {
        conversationId,
        content: `${MARKER}1`,
        type: 0,
        tempId: `${MARKER}1`,
      }),
      emit(socket, {
        conversationId,
        content: `${MARKER}2`,
        type: 0,
        tempId: `${MARKER}2`,
      }),
    ]);

    if (a.status !== 'ok' || b.status !== 'ok') {
      throw new Error(`ack not ok: ${JSON.stringify({ a, b })}`);
    }
    if (a.data.seqId === b.data.seqId) {
      throw new Error(`duplicate seqId: ${a.data.seqId}`);
    }

    const count = Number(
      psql(
        `select count(*) from "ChatMessage" where content like '${MARKER}%'`,
      ),
    );
    if (count !== 2) throw new Error(`expected 2 persisted messages, got ${count}`);

    console.log(
      `PASS seqA=${a.data.seqId} seqB=${b.data.seqId} persisted=${count}`,
    );
  } finally {
    socket.close();
    psql(`delete from "ChatMessage" where content like '${MARKER}%'`);
    psql(
      `update "Conversation" set handler_id=${oldHandler ? `'${oldHandler}'` : 'NULL'} where id='${conversationId}'`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
