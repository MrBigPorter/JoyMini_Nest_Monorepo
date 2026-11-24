/**
 * 极小的 HTTP 封装：统一响应壳、节流、重试、错误分类。
 *
 * 为什么不用 tools/simulator 的 requestJson：它是模块私有的，而端到端
 * 验收需要自己的节流（全局 throttler 是 60 次/分/IP）和 429 计数。
 */
import { apiUrl } from "./config.mjs";

export const DEFAULT_TIMEOUT_MS = 30_000;
/** 后端统一响应壳的成功码（见 common/interceptor） */
export const SUCCESS_CODE = 10000;

export class E2EHttpError extends Error {
  constructor({ method, route, status, code, message, retryAfterMs, cause }) {
    const parts = [`${method} ${route} 失败`];
    if (status) parts.push(`HTTP ${status}`);
    if (code !== undefined && code !== null) parts.push(`code ${code}`);
    if (message) parts.push(String(message));
    super(parts.join("："), { cause });
    this.name = "E2EHttpError";
    this.method = method;
    this.route = route;
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }

  /** 只有网络错误、429、5xx 值得重试；业务错误重试没有意义。 */
  get retryable() {
    return this.status === undefined || this.status === 429 || this.status >= 500;
  }
}

function parseRetryAfter(headers) {
  const raw = headers?.get?.("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 把 `/v1/...` 请求发到后端，并拆掉 `{code,message,tid,data}` 外壳。
 *
 * 非 2xx 或 code !== 10000 一律抛 E2EHttpError；调用方可以按 status 处理。
 */
export async function requestJson({
  config,
  route,
  method = "GET",
  token,
  body,
  csrf,
  deviceId,
  headers: extraHeaders,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const url = apiUrl(config, route);
  const headers = {
    accept: "application/json",
    "user-agent": "JoyMiniE2E/1.0 (+acceptance-test)",
    ...extraHeaders,
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  if (deviceId) {
    headers["x-device-id"] = deviceId;
    headers["x-device-model"] = "e2e-headless";
    headers["x-country-code"] = "63";
  }
  if (csrf) {
    headers["x-csrf-token"] = csrf.token;
    headers.cookie = csrf.cookie;
  }

  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    });
  } catch (error) {
    throw new E2EHttpError({
      method,
      route,
      message: error?.message ?? String(error),
      cause: error,
    });
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
    throw new E2EHttpError({
      method,
      route,
      status: response.status,
      code: payload?.code,
      message: payload?.message,
      retryAfterMs: parseRetryAfter(response.headers),
    });
  }

  if (payload && typeof payload === "object" && "code" in payload) {
    if (payload.code !== SUCCESS_CODE) {
      throw new E2EHttpError({
        method,
        route,
        status: response.status,
        code: payload.code,
        message: payload.message,
      });
    }
    return payload.data;
  }
  return payload;
}

/**
 * 滑动间隔节流器：把请求均匀摊开，保证任意 60 秒窗口内不超过上限。
 *
 * 用「下一次可用时间」而不是窗口计数：并发调用在同一个事件循环
 * turn 里分配到的都是不同时间片，不会出现同时打满。
 */
export function createThrottle({
  perMinute,
  now = () => Date.now(),
  sleepImpl = sleep,
} = {}) {
  if (!Number.isFinite(perMinute) || perMinute <= 0) {
    throw new Error(`perMinute 必须是正数，收到 ${perMinute}`);
  }
  const intervalMs = 60_000 / perMinute;
  let nextAt = 0;

  return {
    intervalMs,
    async acquire() {
      const current = now();
      const slot = Math.max(current, nextAt);
      nextAt = slot + intervalMs;
      const waitMs = slot - current;
      if (waitMs > 0) await sleepImpl(waitMs);
    },
  };
}

function backoffMs(error, attempt) {
  if (error?.retryAfterMs > 0) return error.retryAfterMs;
  return Math.min(30_000, 500 * 2 ** attempt);
}

/**
 * 重试包装：只对可重试错误生效，且默认 3 次。
 */
export async function withRetry(
  fn,
  { attempts = 3, sleepImpl = sleep, onRetry = null } = {},
) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const retryable = error?.retryable ?? false;
      if (!retryable || attempt === attempts - 1) throw error;
      const waitMs = backoffMs(error, attempt);
      onRetry?.({ attempt: attempt + 1, waitMs, error });
      await sleepImpl(waitMs);
    }
  }
  throw lastError;
}

/**
 * 客户端 HTTP 通道：节流 + 重试 + 计数。
 *
 * 计数用于报告里的「HTTP 429 / 重试次数」，不是用来冒充业务结果。
 * `stats` 可以由调用方注入，与 admin/judge 请求共用同一份计数。
 */
export function createHttpTransport(
  config,
  { fetchImpl, sleepImpl = sleep, stats: injectedStats = null } = {},
) {
  const throttle = createThrottle({
    perMinute: config.httpPerMinute,
    sleepImpl,
  });
  const stats = injectedStats ?? { requests: 0, throttled: 0, retries: 0 };

  return {
    stats,
    throttle,
    async request(route, options = {}) {
      return withRetry(
        async () => {
          await throttle.acquire();
          stats.requests += 1;
          try {
            return await requestJson({
              config,
              route,
              fetchImpl,
              ...options,
            });
          } catch (error) {
            if (error?.status === 429) stats.throttled += 1;
            throw error;
          }
        },
        {
          attempts: options.attempts ?? 3,
          sleepImpl,
          onRetry: () => {
            stats.retries += 1;
          },
        },
      );
    },
  };
}
