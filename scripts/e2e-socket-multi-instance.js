#!/usr/bin/env node
/**
 * 双实例 Socket.IO 广播 e2e
 *
 * 在 backend 容器内运行：
 *   docker exec -w /app lucky-backend-dev node scripts/e2e-socket-multi-instance.js
 *
 * 验证目标：
 *   客户端 A 连实例 1（3000），客户端 B 连实例 2（3001），
 *   两者加入同一会话房间；A 发消息后，B 必须通过 Redis adapter 收到。
 */
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const { io } = require("socket.io-client");
const { PrismaClient, ConversationType } = require("@prisma/client");

const FIRST_PORT = Number(process.env.E2E_FIRST_PORT || 3000);
const SECOND_PORT = Number(process.env.E2E_SECOND_PORT || 3001);
const FIRST_URL = `http://localhost:${FIRST_PORT}`;
const SECOND_URL = `http://localhost:${SECOND_PORT}`;
const HEALTH_TIMEOUT_MS = 90_000;
const EVENT_TIMEOUT_MS = 15_000;
const API_PREFIX = "/api/v1";
const REUSE_SECOND = process.env.E2E_REUSE_SECOND === "1";

const prisma = new PrismaClient();
let secondInstance;
let secondLogs = "";
let clientA;
let clientB;
let conversationId;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}${API_PREFIX}/health`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await sleep(500);
  }
  throw new Error(`instance at ${baseUrl} not healthy: ${lastError}`);
}

function connectClient(baseUrl, token) {
  return new Promise((resolve, reject) => {
    const socket = io(`${baseUrl}/events`, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
      timeout: 10_000,
    });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`connect timeout: ${baseUrl}`));
    }, 10_000);

    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      socket.close();
      reject(new Error(`connect_error ${baseUrl}: ${error.message}`));
    });
  });
}

function emitWithAck(socket, event, payload, timeoutMs = EVENT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`ack timeout: ${event}`)),
      timeoutMs,
    );
    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

async function joinConversation(socket, id) {
  const response = await emitWithAck(socket, "join_chat", {
    conversationId: id,
  });
  if (response?.status !== "joined") {
    throw new Error(`join_chat failed: ${JSON.stringify(response)}`);
  }
}

async function waitForLog(pattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (secondLogs.includes(pattern)) return;
    await sleep(200);
  }
  throw new Error(`second instance log not found: ${pattern}`);
}

async function run() {
  const user = await prisma.user.findFirst({ select: { id: true } });
  if (!user) throw new Error("no user found in DB");

  const conversation = await prisma.conversation.create({
    data: {
      type: ConversationType.SUPPORT,
      status: 1,
      name: "multi-instance-e2e",
      threadId: randomUUID(),
      handlerId: "e2e-multi-instance", // 非空 → 不触发 AI
      lastMsgSeqId: 0,
    },
  });
  conversationId = conversation.id;
  await prisma.chatMember.create({
    data: { conversationId, userId: user.id, role: "OWNER" },
  });

  console.log(
    `[multi-instance] user=${user.id} conversation=${conversationId}`,
  );
  if (!REUSE_SECOND) {
    console.log(`[multi-instance] starting second instance on :${SECOND_PORT}`);

    secondInstance = spawn(process.execPath, ["dist/main.js"], {
      cwd: path.resolve(__dirname, "..", "apps", "api"),
      env: { ...process.env, PORT: String(SECOND_PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    secondInstance.stdout.on("data", (chunk) => {
      secondLogs += chunk.toString();
    });
    secondInstance.stderr.on("data", (chunk) => {
      secondLogs += chunk.toString();
    });
    secondInstance.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        secondLogs += `\n[second instance exited with code ${code}]\n`;
      }
    });
  } else {
    console.log("[multi-instance] reusing existing instance on :3001");
  }

  await waitForHealth(SECOND_URL, HEALTH_TIMEOUT_MS);
  if (!REUSE_SECOND) {
    await waitForLog("Socket.IO Redis adapter enabled", 30_000);
  }
  console.log("[multi-instance] second instance healthy");

  const token = jwt.sign(
    { sub: user.id, role: "user", type: "client" },
    process.env.JWT_SECRET,
    { expiresIn: "10m" },
  );

  clientA = await connectClient(FIRST_URL, token);
  clientB = await connectClient(SECOND_URL, token);
  console.log("[multi-instance] clients connected to 3000 and 3001");

  await joinConversation(clientA, conversationId);
  await joinConversation(clientB, conversationId);
  console.log("[multi-instance] both clients joined the same room");

  const marker = `multi-instance-${randomUUID()}`;
  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `client B did not receive ${marker} within ${EVENT_TIMEOUT_MS}ms`,
          ),
        ),
      EVENT_TIMEOUT_MS,
    );
    // 服务端统一走 dispatch 事件，内部再按 type 路由
    clientB.on("dispatch", (envelope) => {
      if (
        envelope?.type === "chat_message" &&
        envelope?.data?.content === marker
      ) {
        clearTimeout(timer);
        resolve(envelope.data);
      }
    });
    // 兼容直接发出 chat_message 的路径
    clientB.on("chat_message", (message) => {
      if (message?.content === marker) {
        clearTimeout(timer);
        resolve(message);
      }
    });
  });

  const ack = await emitWithAck(clientA, "send_message", {
    conversationId,
    content: marker,
    type: 0,
    tempId: randomUUID(),
  });
  if (ack?.error) {
    throw new Error(`send_message failed: ${JSON.stringify(ack)}`);
  }

  const message = await received;
  console.log(
    `[multi-instance] PASS: instance 1 -> Redis -> instance 2 delivered message ${message.id}`,
  );

  if (!REUSE_SECOND && !secondLogs.includes("Socket.IO Redis adapter enabled")) {
    throw new Error(
      "second instance did not report a Redis adapter; check logs below",
    );
  }
}

async function cleanup() {
  try {
    clientA?.disconnect();
    clientB?.disconnect();
  } catch {}
  try {
    if (secondInstance && !secondInstance.killed) {
      secondInstance.kill("SIGTERM");
      await sleep(1000);
    }
  } catch {}
  try {
    if (conversationId) {
      await prisma.chatMessage.deleteMany({ where: { conversationId } });
      await prisma.chatMember.deleteMany({ where: { conversationId } });
      await prisma.conversation.deleteMany({ where: { id: conversationId } });
    }
  } catch (error) {
    console.warn(`[multi-instance] cleanup warning: ${error.message}`);
  }
  await prisma.$disconnect().catch(() => {});
}

run()
  .then(async () => {
    await cleanup();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(`[multi-instance] FAIL: ${error.message}`);
    if (secondLogs) {
      console.error("--- second instance logs (tail) ---");
      console.error(secondLogs.split("\n").slice(-40).join("\n"));
    }
    await cleanup();
    process.exit(1);
  });
