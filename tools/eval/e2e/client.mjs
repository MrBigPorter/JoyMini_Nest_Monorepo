/**
 * 真实客户端：按 Flutter App 生产链路收发明细。
 *
 *   发送：POST /v1/chat/message（HTTP，带客户端生成的 UUID）
 *   接收：Socket.IO `/events` 的 `dispatch` 事件
 *
 * 记录每一轮的原文、回答、`meta.sources`、时间戳与时延——
 * 判定只看这些真实字段，不从数据库反推。
 */
import { randomUUID } from "node:crypto";

import { io } from "socket.io-client";

import { E2EHttpError } from "./http.mjs";
import { refreshAccountToken } from "../../simulator/provision.mjs";

export const DISPATCH_EVENT = "dispatch";
export const SOCKET_EVENTS = Object.freeze([
  DISPATCH_EVENT,
  "chat_message",
  "ai_confirm",
  "ai_transfer",
  "ai_action_result",
  "ai_error",
]);

const CONNECT_TIMEOUT_MS = 10_000;
const ACK_TIMEOUT_MS = 10_000;

/**
 * Socket 事件统一成 `{type, data}`：后端走 `dispatch`，也有少量直发旧事件。
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

/** 只认被 AI 回复的 chat_message（isAi 或 senderId === bot）。 */
export function isAiChatMessage(data, conversationId, botUserId) {
  if (!data || typeof data !== "object") return false;
  if (conversationId && data.conversationId !== conversationId) return false;
  if (data.isAi === true) return true;
  return Boolean(botUserId) && data.senderId === botUserId;
}

/**
 * 把一条 chat_message 归一成判定需要的字段。
 * sources 是后端真实下发到客户端的检索引用，判定必须以它为准。
 */
export function extractReply(data) {
  const meta = data?.meta && typeof data.meta === "object" ? data.meta : null;
  const sources = Array.isArray(meta?.sources) ? meta.sources : [];
  return {
    messageId: data?.id ?? null,
    content: typeof data?.content === "string" ? data.content : "",
    seqId: data?.seqId ?? null,
    createdAt: data?.createdAt ?? null,
    metaKind: typeof meta?.kind === "string" ? meta.kind : null,
    action: typeof meta?.action === "string" ? meta.action : null,
    sources,
    meta,
  };
}

/**
 * 事件总线：一次注册、整条会话复用；按游标消费，避免上一轮的事件串台。
 *
 * 会话会在用例之间轮换（每例一个新 conversation），所以会话 ID 必须
 * 走 getter 动态读取，不能在建总线那一刻固化下来。
 */
export function createEventBus({
  socket,
  conversationId = null,
  getConversationId = null,
  botUserId,
}) {
  const currentConversationId = () =>
    getConversationId ? getConversationId() : conversationId;
  const events = [];
  const seenMessageIds = new Set();
  const waiters = new Set();
  let cursor = 0;

  function classify(normalized) {
    const { type, data } = normalized;
    if (type === "chat_message") {
      if (!isAiChatMessage(data, currentConversationId(), botUserId)) return null;
      const id = data?.id;
      if (id && seenMessageIds.has(id)) return null;
      if (id) seenMessageIds.add(id);
      const reply = extractReply(data);
      const kind = reply.metaKind;
      const eventType =
        kind === "confirm_card"
          ? "confirm_card"
          : kind === "action_result"
            ? "action_result"
            : "reply";
      return { type: eventType, at: Date.now(), data, reply };
    }
    if (type === "ai_confirm") {
      if (data?.conversationId && data.conversationId !== currentConversationId()) {
        return null;
      }
      return { type: "confirm", at: Date.now(), data };
    }
    if (type === "ai_transfer") {
      if (data?.conversationId && data.conversationId !== currentConversationId()) {
        return null;
      }
      return { type: "transfer", at: Date.now(), data };
    }
    if (type === "ai_action_result") {
      if (data?.conversationId && data.conversationId !== currentConversationId()) {
        return null;
      }
      return { type: "action_result_event", at: Date.now(), data };
    }
    if (type === "ai_error") {
      return { type: "ai_error", at: Date.now(), data };
    }
    return null;
  }

  function handle(eventName, payload) {
    const record = classify(normalizeDispatch(eventName, payload));
    if (!record) return;
    events.push(record);
    for (const waiter of [...waiters]) {
      if (events.indexOf(record) < waiter.from) continue;
      if (!waiter.predicate(record)) continue;
      waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(record);
    }
  }

  const listeners = SOCKET_EVENTS.map((eventName) => {
    const listener = (payload) => handle(eventName, payload);
    socket.on(eventName, listener);
    return [eventName, listener];
  });

  function mark() {
    return Math.max(cursor, events.length);
  }

  function waitFor(predicate, { timeoutMs = 90_000, from = 0 } = {}) {
    const start = Math.max(from, cursor);
    for (let index = start; index < events.length; index += 1) {
      if (predicate(events[index])) {
        cursor = index + 1;
        return Promise.resolve(events[index]);
      }
    }
    return new Promise((resolve) => {
      const waiter = {
        from: start,
        predicate,
        resolve: null,
        timer: null,
      };
      waiter.timer = setTimeout(() => {
        waiters.delete(waiter);
        resolve(null);
      }, timeoutMs);
      waiter.resolve = (record) => resolve(record);
      waiters.add(waiter);
    });
  }

  return {
    events,
    mark,
    waitFor,
    /** 关闭卡片/结果等已经出现在队列里的事件 */
    peek(predicate, { from = 0 } = {}) {
      const start = Math.max(from, cursor);
      for (let index = start; index < events.length; index += 1) {
        if (predicate(events[index])) {
          cursor = index + 1;
          return events[index];
        }
      }
      return null;
    },
    dispose() {
      for (const [eventName, listener] of listeners) {
        socket.off(eventName, listener);
      }
      listeners.length = 0;
      waiters.clear();
    },
  };
}

function connectSocket({ socketUrl, token, timeoutMs = CONNECT_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let socket;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket?.off("connect", onConnect);
      socket?.off("connect_error", onError);
      fn(value);
    };
    const timer = setTimeout(() => {
      socket?.disconnect();
      finish(reject, new Error(`Socket 连接超时（${timeoutMs}ms）`));
    }, timeoutMs);
    const onConnect = () => finish(resolve, socket);
    const onError = (error) => {
      // 交给上层等一下再试；这里先关掉半死不活的连接，避免泄漏
      try {
        socket.disconnect();
      } catch {
        // ignore
      }
      finish(reject, new Error(`Socket 连接失败：${error?.message ?? error}`));
    };

    try {
      socket = io(socketUrl, {
        auth: { token },
        transports: ["websocket"],
        // 后端重启 / 网络抖动会把连接掐断（实际跑全量时 4 个 client 在同一秒
        // 全部断开）。不重连的话，后续每一轮都在等一个永远到不了的 dispatch，
        // 只能靠超时兜底，等于把可用性问题算到答案质量头上。
        reconnection: true,
        reconnectionAttempts: 30,
        reconnectionDelay: 500,
        reconnectionDelayMax: 5_000,
        forceNew: true,
        timeout: timeoutMs,
      });
      socket.once("connect", onConnect);
      socket.once("connect_error", onError);
    } catch (error) {
      finish(reject, new Error(`Socket 初始化失败：${error?.message ?? error}`));
    }
  });
}

function emitWithAck(socket, event, payload, timeoutMs = ACK_TIMEOUT_MS) {
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
      settled = true;
      clearTimeout(timer);
      resolve({ error: error?.message ?? String(error) });
    }
  });
}

/**
 * 客户端会话：一个账号 × 一条会话。
 *
 * `transport` 由调用方注入（共享节流与计数）；这里只负责协议与记录。
 */
export function createClientSession(
  config,
  account,
  { transport, logger = console, onTokenRefresh = null, botUserId = null } = {},
) {
  if (!transport) throw new Error("createClientSession 需要注入 transport");

  let currentAccount = { ...account };
  let socket = null;
  let bus = null;
  let conversationId = null;
  /** 断开次数：等待回答期间掉线要立刻上报，而不是空等超时。 */
  let dropSeq = 0;
  let reconnects = 0;

  async function http(route, options = {}) {
    try {
      return await transport.request(route, {
        token: currentAccount.token,
        deviceId: currentAccount.deviceId,
        ...options,
      });
    } catch (error) {
      if (!(error instanceof E2EHttpError) || error.status !== 401) throw error;
      currentAccount = await refreshAccountToken(config, currentAccount);
      await onTokenRefresh?.(currentAccount);
      return transport.request(route, {
        token: currentAccount.token,
        deviceId: currentAccount.deviceId,
        ...options,
      });
    }
  }

  /** 加入当前会话房间；失败只记日志，不中断用例。 */
  async function joinConversation(id = conversationId) {
    if (!socket || !id) return null;
    const ack = await emitWithAck(socket, "join_chat", { conversationId: id });
    if (ack?.status !== "joined") {
      logger.warn?.(
        `[e2e] join_chat 未确认（${ack?.status ?? ack?.error ?? "timeout"}）；` +
          "私有房间仍可接收 AI 回复",
      );
    }
    return ack;
  }

  async function openConversation() {
    const data = await http(
      `/v1/chat/business?businessId=${encodeURIComponent(config.businessId)}` +
        `&trafficSource=${encodeURIComponent(config.trafficSource)}`,
    );
    const id = data?.conversationId;
    if (!id) throw new Error("GET /v1/chat/business 响应缺少 conversationId");
    conversationId = String(id);
    // 切到新会话后必须重新 join_chat，否则私有房间的卡片/结果事件收不到
    await connect();
    await joinConversation(conversationId);
    return conversationId;
  }

  async function connect() {
    if (socket?.connected) return socket;
    // socket 存在但不在线 = 断线且还没重连完（或已彻底失联）。
    // 旧实现直接 `if (socket) return socket`，于是断线后整轮都在等不会来的事件。
    if (socket) {
      try {
        socket.removeAllListeners();
        socket.disconnect();
      } catch {
        // 丢弃旧连接失败也无所谓，下面会建新的
      }
      bus?.dispose();
      socket = null;
      bus = null;
    }
    socket = await connectSocket({
      socketUrl: config.socketUrl,
      token: currentAccount.token,
    });
    bus = createEventBus({
      socket,
      getConversationId: () => conversationId,
      botUserId,
    });
    // socket.io 自动重连后房间成员关系会丢，必须重新 join 当前会话
    socket.on("connect", () => {
      reconnects += 1;
      if (conversationId) void joinConversation(conversationId);
    });
    socket.on("disconnect", (reason) => {
      dropSeq += 1;
      logger.warn?.(
        `[e2e] socket 断开（${reason}，第 ${dropSeq} 次），等待自动重连`,
      );
    });
    await joinConversation(conversationId);
    return socket;
  }

  /**
   * 发送一轮文本，等到终态事件。
   *
   * 终态优先级：ai_confirm > ai_transfer > ai_error > 普通 AI 回复
   * （确认卡片与动作结果消息单独记录，不算普通回复）。
   */
  /**
   * 等终态事件；等待期间掉线就立刻返回 `{ dropped: true }`。
   *
   * socket 一断，回答不可能再通过这条连接送达，继续空等到 timeout 只会把
   * 「连接掉了」伪装成「AI 不回」。上层看到 dropped 会重连后重发。
   */
  function waitForTerminal(predicate, { timeoutMs, from }) {
    const startDrop = dropSeq;
    const waited = bus.waitFor(predicate, { timeoutMs, from });
    if (!socket?.connected || dropSeq > startDrop) {
      return Promise.resolve({ dropped: true, record: null });
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        socket?.off("disconnect", onDrop);
        resolve(value);
      };
      const onDrop = () => finish({ dropped: true, record: null });
      socket.once("disconnect", onDrop);
      waited.then((record) => finish({ dropped: false, record }));
    });
  }

  async function send(content, { timeoutMs = config.replyTimeoutMs } = {}) {
    if (!conversationId) await openConversation();
    await connect();

    const from = bus.mark();
    const messageId = randomUUID();
    const sentAt = Date.now();
    const sent = await http("/v1/chat/message", {
      method: "POST",
      body: {
        id: messageId,
        conversationId,
        content,
        type: 0,
      },
    });

    const { dropped, record: terminal } = await waitForTerminal(
      (event) =>
        event.type === "confirm" ||
        event.type === "transfer" ||
        event.type === "ai_error" ||
        event.type === "reply",
      { timeoutMs, from },
    );

    const repliedAt = terminal?.at ?? null;
    return {
      ok: Boolean(terminal),
      socketDropped: dropped,
      question: content,
      requestMessageId: sent?.id ?? messageId,
      sentAt,
      repliedAt,
      latencyMs: repliedAt === null ? null : repliedAt - sentAt,
      outcome: dropped ? "disconnected" : terminal?.type ?? "timeout",
      reply: terminal?.type === "reply" ? terminal.reply : null,
      replies: bus.events
        .slice(from)
        .filter((event) => event.type === "reply")
        .map((event) => event.reply),
      confirm: terminal?.type === "confirm" ? terminal.data : null,
      transfer: terminal?.type === "transfer" ? terminal.data : null,
      errorMessage:
        terminal?.type === "ai_error"
          ? (terminal.data?.content ?? "ai_error")
          : null,
      events: bus.events.slice(from),
    };
  }

  /** 执行确认卡片；提现会走 OTP 二段。返回执行结果与结果事件。 */
  async function confirm(
    confirmData,
    { otpCode = config.otpCode, timeoutMs = config.actionTimeoutMs } = {},
  ) {
    const from = bus.mark();
    const token = confirmData?.confirmToken ?? confirmData?.token;
    if (!token) throw new Error("确认卡片缺少 confirmToken");

    // 确认接口不是幂等的：token 一旦被消费，重试只会拿到「token 已失效」，
    // 把第一次的真实失败（例如 500）盖掉。所以这里禁止自动重试。
    const result = await http("/v1/ai/customer/confirm", {
      method: "POST",
      body: { token, requestId: confirmData?.requestId ?? undefined },
      attempts: 1,
    });

    let otp = null;
    if (confirmData?.needsOtp) {
      otp = await http("/v1/ai/customer/confirm/otp", {
        method: "POST",
        body: { code: otpCode },
        attempts: 1,
      });
    }

    const { record: outcome } = await waitForTerminal(
      (event) =>
        event.type === "action_result_event" || event.type === "action_result",
      { timeoutMs, from },
    );

    return {
      result,
      otp,
      outcome: outcome?.data ?? null,
      eventType: outcome?.type ?? null,
    };
  }

  /** 单独等一条动作结果（例如确认后结果晚于 HTTP 返回）。 */
  function waitForActionResult({ timeoutMs = config.actionTimeoutMs, from = 0 } = {}) {
    return bus.waitFor(
      (event) =>
        event.type === "action_result_event" || event.type === "action_result",
      { timeoutMs, from },
    );
  }

  function close() {
    try {
      if (socket && conversationId) {
        socket.emit("leave_chat", { conversationId });
      }
    } catch {
      // 关闭失败不影响结果
    }
    bus?.dispose();
    socket?.disconnect();
    socket = null;
    bus = null;
  }

  return {
    get conversationId() {
      return conversationId;
    },
    get account() {
      return currentAccount;
    },
    /** 通用已登录请求（fixture / 副作用核验都用它，不走另一套凭据） */
    request: http,
    openConversation,
    connect,
    send,
    confirm,
    waitForActionResult,
    mark: () => bus?.mark() ?? 0,
    close,
  };
}
