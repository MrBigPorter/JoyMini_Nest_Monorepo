#!/usr/bin/env node
/**
 * Socket 单会话 driver（P0 / Task 4）。
 *
 * 一个账号、一个场景、一条会话：
 *   GET /v1/chat/business?businessId=... -> conversationId
 *   io(socketUrl, { auth: { token }, transports: ['websocket'] })
 *   send_message -> 等 AI 回复（chat_message / isAi=true）
 *
 * 安全边界（硬约束）：
 * - 收到 `ai_confirm` 立即结束，**任何场景**都一样；从不调用 /confirm 或 /confirm/otp
 * - 收到 `ai_transfer` 立即结束
 * - 90 秒没有 AI 回复记为 noReply 并结束，不无限挂起
 * - 关闭时只 emit `leave_chat` + disconnect，不调用关闭会话 API
 * - HTTP 401 时用 refreshToken 刷新一次并重试一次；日志/错误里不含 token/手机号
 *
 * 所有 Socket 业务事件都由后端 `dispatch` 事件承载：
 *   { type: "chat_message" | "ai_confirm" | "ai_transfer", data: {...} }
 * 为兼容直发事件，也同时监听同名事件。
 */
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import { io } from "socket.io-client";

import { apiUrl, loadConfig } from "./config.mjs";
import { humanize, nextDelayMs, pickPersona } from "./humanize.mjs";
import {
  USER_AGENT,
  loadAccounts,
  redactSecrets,
  refreshAccountToken,
} from "./provision.mjs";
import { SCENARIOS, renderTurns } from "./scenarios.mjs";

export const CONNECT_TIMEOUT_MS = 10_000;
export const REPLY_TIMEOUT_MS = 90_000;
export const ACK_TIMEOUT_MS = 10_000;
export const JOIN_TIMEOUT_MS = 5_000;
const HTTP_TIMEOUT_MS = 30_000;

/** 后端 `dispatch` 事件名（见 packages/shared/src/im/constants.ts）。 */
const DISPATCH_EVENT = "dispatch";
const WATCHED_SOCKET_EVENTS = Object.freeze([
  DISPATCH_EVENT,
  "chat_message",
  "ai_confirm",
  "ai_transfer",
]);

/**
 * 会话接口地址。
 *
 * @param {{ apiBaseUrl: string }} config
 * @param {string} [businessId]
 * @returns {string}
 */
export function buildBusinessUrl(config, businessId = config.businessId) {
  const id = String(businessId ?? "").trim();
  if (!id) throw new Error("businessId 不能为空");
  return apiUrl(
    config,
    `/v1/chat/business?businessId=${encodeURIComponent(id)}`,
  );
}

/**
 * `send_message` 上行载荷。type 固定 0（文本）。
 *
 * @param {string} conversationId
 * @param {string} content
 * @param {{ tempId?: string, type?: number }} [opts]
 * @returns {{ conversationId: string, content: string, type: number, tempId: string }}
 */
export function buildSendMessagePayload(
  conversationId,
  content,
  { tempId = randomUUID(), type = 0 } = {},
) {
  const convId = String(conversationId ?? "").trim();
  if (!convId) throw new Error("conversationId 不能为空");
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error("content 不能为空");
  }
  if (typeof tempId !== "string" || tempId.trim() === "") {
    throw new Error("tempId 不能为空");
  }
  return { conversationId: convId, content, type, tempId };
}

/**
 * 把 Socket 收到的原始事件统一成 `{ type, data }`。
 *
 * 后端统一用 `dispatch` 发 `{ type, data }`；部分旧路径可能直接发同名事件。
 *
 * @param {string} eventName
 * @param {unknown} payload
 * @returns {{ type: string, data: any }}
 */
export function normalizeDispatch(eventName, payload) {
  if (
    eventName === DISPATCH_EVENT &&
    payload &&
    typeof payload === "object" &&
    typeof payload.type === "string"
  ) {
    return { type: payload.type, data: payload.data ?? null };
  }
  return { type: eventName, data: payload ?? null };
}

function matchesConversation(data, conversationId) {
  if (!data || typeof data !== "object" || !conversationId) return false;
  // confirm/transfer 可能只投递到用户私有房间；缺 conversationId 时按单会话处理。
  if (data.conversationId === undefined || data.conversationId === null) {
    return true;
  }
  return data.conversationId === conversationId;
}

function isAiMessage(data, conversationId, botUserId) {
  if (!data || typeof data !== "object") return false;
  if (data.conversationId !== conversationId) return false;
  if (data.isAi === true) return true;
  // 兼容旧后端：没有 isAi 字段时退回 senderId === botUserId。
  return Boolean(botUserId) && data.senderId === botUserId;
}

/**
 * 把事件归类为 driver 的状态迁移；无关事件返回 null。
 *
 * @param {{ type: string, data: any }} event  normalizeDispatch 的产物
 * @param {string} conversationId
 * @param {{ botUserId?: string | null }} [opts]
 * @returns {"reply" | "confirm" | "transfer" | null}
 */
export function classifyEvent(event, conversationId, opts = {}) {
  if (!event || typeof event !== "object") return null;
  const { type, data } = event;

  if (type === "ai_confirm") {
    return matchesConversation(data, conversationId) ? "confirm" : null;
  }
  if (type === "ai_transfer") {
    return matchesConversation(data, conversationId) ? "transfer" : null;
  }
  if (type === "chat_message") {
    return isAiMessage(data, conversationId, opts.botUserId) ? "reply" : null;
  }
  return null;
}

function httpError(message, { status, code } = {}) {
  const error = new Error(redactSecrets(message));
  if (status !== undefined) error.status = status;
  if (code !== undefined) error.code = code;
  return error;
}

/**
 * GET /v1/chat/business -> conversationId。
 * 响应壳为 { code, message, tid, data }，data 里是 { conversationId }。
 */
async function fetchBusinessConversation({
  config,
  account,
  businessId,
  fetchImpl,
  timeoutMs = HTTP_TIMEOUT_MS,
}) {
  const url = buildBusinessUrl(config, businessId);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${account.token}`,
        "user-agent": USER_AGENT,
        "x-device-id": account.deviceId ?? "",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw httpError(`GET /v1/chat/business 失败：${error?.message ?? error}`);
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    throw httpError(
      `GET /v1/chat/business 失败：HTTP ${response.status}${
        payload?.message ? `（${payload.message}）` : ""
      }`,
      { status: response.status, code: payload?.code },
    );
  }

  const data =
    payload && typeof payload === "object" && "code" in payload
      ? (() => {
          if (payload.code !== 10000) {
            throw httpError(
              `GET /v1/chat/business 业务错误：code ${payload.code} ${
                payload.message ?? ""
              }`,
              { status: response.status, code: payload.code },
            );
          }
          return payload.data;
        })()
      : payload;

  const conversationId = data?.conversationId;
  if (!conversationId) {
    throw httpError("GET /v1/chat/business 响应缺少 conversationId");
  }
  return { conversationId: String(conversationId), account };
}

/**
 * 开会话；401 时刷新 token 一次并重试一次。
 */
async function openConversation({
  config,
  account,
  businessId,
  fetchImpl,
  onTokenRefresh,
}) {
  let current = { ...account };
  let refreshed = false;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetchBusinessConversation({
        config,
        account: current,
        businessId,
        fetchImpl,
      });
    } catch (error) {
      if (error?.status !== 401 || refreshed) throw error;
      refreshed = true;
      current = await refreshAccountToken(config, current, { fetchImpl });
      onTokenRefresh?.(current);
    }
  }

  throw httpError("GET /v1/chat/business 重试次数耗尽");
}

/** 等待 Socket connect；超时或 connect_error 都 reject。 */
function connectSocket({ socketUrl, token, connectTimeoutMs }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let socket;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      socket?.disconnect();
      reject(new Error(`Socket 连接超时（${connectTimeoutMs}ms）`));
    }, connectTimeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      socket?.off("connect", onConnect);
      socket?.off("connect_error", onError);
    };
    const onConnect = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(socket);
    };
    const onError = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      socket?.disconnect();
      reject(new Error(`Socket 连接失败：${error?.message ?? error}`));
    };

    try {
      socket = io(socketUrl, {
        auth: { token },
        transports: ["websocket"],
        reconnection: false,
        forceNew: true,
        timeout: connectTimeoutMs,
      });
      socket.once("connect", onConnect);
      socket.once("connect_error", onError);
    } catch (error) {
      settled = true;
      cleanup();
      reject(new Error(`Socket 初始化失败：${error?.message ?? error}`));
    }
  });
}

/** emit 带 ack；超时返回 null，不抛错（消息已经发出，可能仍然生效）。 */
function emitWithAck(socket, event, payload, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, timeoutMs);

    try {
      socket.emit(event, payload, (ack) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ack ?? {});
      });
    } catch (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ error: error?.message ?? String(error) });
    }
  });
}

/**
 * 事件泵：一次注册、整个会话复用。
 *
 * - `waitForReply`：等 AI 回复；期间收到 confirm/transfer 会立刻返回对应状态
 * - `waitForStop`：turn 间隔期间也盯着 confirm/transfer（确认卡片可能在
 *   两轮之间到达，不能因为“不在等待回复”就漏掉）
 */
function createEventPump({ socket, conversationId, botUserId }) {
  const listeners = [];
  const stopWaiters = new Set();
  let replyWaiter = null;
  let stopped = null;

  const settleStop = (kind) => {
    if (!stopped) {
      stopped = kind;
      for (const notify of stopWaiters) notify(kind);
      stopWaiters.clear();
    }
    if (replyWaiter) {
      const notify = replyWaiter;
      replyWaiter = null;
      notify(kind);
    }
  };

  const handle = (eventName, payload) => {
    const kind = classifyEvent(
      normalizeDispatch(eventName, payload),
      conversationId,
      {
        botUserId,
      },
    );
    if (kind === "confirm" || kind === "transfer") {
      settleStop(kind);
      return;
    }
    if (kind === "reply" && replyWaiter) {
      const notify = replyWaiter;
      replyWaiter = null;
      notify("reply");
    }
  };

  for (const eventName of WATCHED_SOCKET_EVENTS) {
    const listener = (payload) => handle(eventName, payload);
    socket.on(eventName, listener);
    listeners.push([eventName, listener]);
  }

  return {
    get stopReason() {
      return stopped;
    },

    waitForReply(timeoutMs) {
      if (stopped) return Promise.resolve(stopped);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          replyWaiter = null;
          resolve("timeout");
        }, timeoutMs);
        replyWaiter = (kind) => {
          clearTimeout(timer);
          resolve(kind);
        };
      });
    },

    waitForStop(timeoutMs) {
      if (stopped) return Promise.resolve(stopped);
      return new Promise((resolve) => {
        const notify = (kind) => {
          clearTimeout(timer);
          resolve(kind);
        };
        const timer = setTimeout(() => {
          stopWaiters.delete(notify);
          resolve("timeout");
        }, timeoutMs);
        stopWaiters.add(notify);
      });
    },

    dispose() {
      for (const [eventName, listener] of listeners) {
        socket.off(eventName, listener);
      }
      listeners.length = 0;
      stopWaiters.clear();
      replyWaiter = null;
    },
  };
}

function emptyResult() {
  return {
    conversationId: null,
    turnsSent: 0,
    replies: 0,
    confirms: 0,
    transferred: false,
    noReply: false,
    errors: [],
  };
}

/**
 * 跑完一个场景的一条会话。
 *
 * @param {{ phone: string, userId: string, token: string, refreshToken: string, deviceId: string }} account
 * @param {{ id: string, intent: string, turns: string[], expectConfirm?: boolean, expectTransfer?: boolean }} scenario
 * @param {{
 *   config?: ReturnType<typeof loadConfig>,
 *   fetchImpl?: typeof fetch,
 *   rng?: () => number,
 *   persona?: { language: "zh" | "en", style: string } | null,
 *   logger?: Pick<Console, "log" | "warn" | "error">,
 *   botUserId?: string | null,
 *   businessId?: string,
 *   replyTimeoutMs?: number,
 *   connectTimeoutMs?: number,
 *   ackTimeoutMs?: number,
 *   maxTurns?: number,
 *   onTokenRefresh?: (account: object) => void | Promise<void>,
 * }} [opts]
 * @returns {Promise<{ conversationId: string | null, turnsSent: number, replies: number, confirms: number, transferred: boolean, noReply: boolean, errors: string[] }>}
 */
export async function runConversation(account, scenario, opts = {}) {
  const {
    config = loadConfig(),
    fetchImpl = globalThis.fetch,
    rng = Math.random,
    persona = null,
    logger = console,
    botUserId = null,
    businessId = config.businessId,
    replyTimeoutMs = REPLY_TIMEOUT_MS,
    connectTimeoutMs = CONNECT_TIMEOUT_MS,
    ackTimeoutMs = ACK_TIMEOUT_MS,
    maxTurns = null,
    onTokenRefresh = null,
  } = opts;

  const result = emptyResult();
  const language = persona?.language === "en" ? "en" : "zh";

  let socket = null;
  let pump = null;

  try {
    const opened = await openConversation({
      config,
      account,
      businessId,
      fetchImpl,
      onTokenRefresh,
    });
    const { conversationId } = opened;
    result.conversationId = conversationId;

    socket = await connectSocket({
      socketUrl: config.socketUrl,
      token: opened.account.token,
      connectTimeoutMs,
    });

    // 会话房间用于实时消息；私有房间在连接时已自动加入，join 失败不致命。
    const joinAck = await emitWithAck(
      socket,
      "join_chat",
      { conversationId },
      JOIN_TIMEOUT_MS,
    );
    if (joinAck?.status !== "joined") {
      logger.warn?.(
        `[driver] join_chat 未确认（${joinAck?.status ?? joinAck?.error ?? "timeout"}），` +
          "仍通过用户私有房间接收 AI 回复",
      );
    }

    pump = createEventPump({ socket, conversationId, botUserId });

    const turns = renderTurns(scenario, rng);
    const plannedTurns =
      Number.isInteger(maxTurns) && maxTurns > 0
        ? turns.slice(0, maxTurns)
        : turns;

    for (let index = 0; index < plannedTurns.length; index += 1) {
      if (pump.stopReason) break;

      const content = humanize(plannedTurns[index], rng, { language });
      const payload = buildSendMessagePayload(conversationId, content);

      const ack = await emitWithAck(
        socket,
        "send_message",
        payload,
        ackTimeoutMs,
      );
      result.turnsSent += 1;

      if (ack === null) {
        result.errors.push("send_message ack 超时");
      } else if (ack.error) {
        result.errors.push(`send_message 被拒绝：${ack.error}`);
        break;
      } else if (ack.status === "error") {
        result.errors.push(
          `send_message 失败：${ack.message ?? "unknown error"}`,
        );
        break;
      }

      const outcome = await pump.waitForReply(replyTimeoutMs);
      if (outcome === "reply") {
        result.replies += 1;
      } else if (outcome === "confirm") {
        result.confirms += 1;
        break;
      } else if (outcome === "transfer") {
        result.transferred = true;
        break;
      } else {
        result.noReply = true;
        break;
      }

      if (index < plannedTurns.length - 1) {
        // 两轮之间也要盯着 confirm/transfer，避免卡片在两轮间隔里到达被漏掉。
        const stopped = await pump.waitForStop(nextDelayMs(rng));
        if (stopped === "confirm") {
          result.confirms += 1;
          break;
        }
        if (stopped === "transfer") {
          result.transferred = true;
          break;
        }
      }
    }
  } catch (error) {
    result.errors.push(redactSecrets(error?.message ?? String(error)));
  } finally {
    pump?.dispose();
    if (socket) {
      try {
        if (result.conversationId) {
          socket.emit("leave_chat", { conversationId: result.conversationId });
        }
      } catch {
        // 关闭阶段任何异常都不影响结果上报。
      }
      socket.disconnect();
    }
  }

  return result;
}

function parseCliInt(flag, value, { min, max }) {
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`${flag} 需要整数，收到 "${text}"`);
  }
  const number = Number(text);
  if (number < min || number > max) {
    throw new Error(`${flag} 必须在 ${min}-${max} 之间，收到 ${number}`);
  }
  return number;
}

export function parseArgs(argv) {
  const options = {
    once: false,
    scenario: null,
    accountIndex: 0,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const readValue = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} 缺少参数值`);
      return argv[i];
    };

    switch (arg) {
      case "--once":
        options.once = true;
        break;
      case "--scenario":
        options.scenario = String(readValue()).trim();
        break;
      case "--account-index":
        options.accountIndex = parseCliInt(arg, readValue(), {
          min: 0,
          max: 99,
        });
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      default:
        throw new Error(`未知参数：${arg}（使用 --help 查看用法）`);
    }
  }

  return options;
}

function printUsage(write = console.log) {
  write(`用法：node tools/simulator/driver.mjs --once --scenario <id>

本地单会话冒烟（Task 5 的 run.mjs 会复用 runConversation）。

选项：
  --once                  执行一次会话（必填）
  --scenario <id>         场景 ID，例如 order_status（必填）
  --account-index <n>     使用账号池中的第 n 个账号（默认 0）
  -h, --help              显示本帮助

环境变量：
  SIM_API_BASE_URL        API 根地址，默认 https://api.joyminis.com/api
  SIM_SOCKET_URL          Socket 地址，默认 https://api.joyminis.com/events
  SIM_BUSINESS_ID         渠道 ID，默认 simulation_support_v1
  SIM_RUNTIME_DIR         运行态目录，默认 tools/simulator/.runtime

安全：收到 ai_confirm / ai_transfer 立即停止；从不调用 /confirm 接口。
`);
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const logger = deps.logger ?? console;
  const config = deps.config ?? loadConfig();
  const options = parseArgs(argv);

  if (options.help) {
    printUsage(logger.log.bind(logger));
    return 0;
  }

  if (!options.once) {
    logger.error("缺少 --once：driver.mjs 只做单会话冒烟，请用 --once。");
    printUsage(logger.error.bind(logger));
    return 1;
  }

  if (!options.scenario) {
    logger.error("缺少 --scenario <id>。");
    logger.error(`可用场景：${SCENARIOS.map((item) => item.id).join(", ")}`);
    return 1;
  }

  const scenario = SCENARIOS.find((item) => item.id === options.scenario);
  if (!scenario) {
    logger.error(`未知场景：${options.scenario}`);
    logger.error(`可用场景：${SCENARIOS.map((item) => item.id).join(", ")}`);
    return 1;
  }

  const accounts = deps.accounts ?? loadAccounts(config.runtimeDir);
  if (accounts.length === 0) {
    logger.error(
      `账号池为空：${config.runtimeDir}/accounts.json 不存在或没有账号。`,
    );
    logger.error(
      "请先运行 node tools/simulator/provision.mjs（会按 5 个/批建号）。",
    );
    return 1;
  }

  const account = accounts[Math.min(options.accountIndex, accounts.length - 1)];
  if (!account) {
    logger.error(`账号索引 ${options.accountIndex} 超出范围`);
    return 1;
  }

  logger.log(
    `[driver] 场景 ${scenario.id}（intent=${scenario.intent}），账号索引 ${options.accountIndex}`,
  );

  const result = await runConversation(account, scenario, {
    config,
    fetchImpl: deps.fetchImpl,
    rng: deps.rng ?? Math.random,
    persona: deps.persona ?? pickPersona(deps.rng ?? Math.random),
    logger,
    onTokenRefresh: deps.onTokenRefresh,
  });

  logger.log(JSON.stringify(result, null, 2));

  const ok =
    Boolean(result.conversationId) &&
    result.errors.length === 0 &&
    !result.noReply;
  return ok ? 0 : 1;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main()
    .then((code) => {
      process.exitCode = code ?? 0;
    })
    .catch((error) => {
      console.error(redactSecrets(error?.message ?? String(error)));
      process.exitCode = 1;
    });
}
