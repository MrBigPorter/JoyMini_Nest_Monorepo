#!/usr/bin/env node
/**
 * 合成流量账号池 provisioning。
 *
 * 流程（与 Flutter 客户端一致）：
 *   POST /v1/otp/request -> POST /v1/otp/verify -> POST /v1/auth/login/otp
 *
 * 安全约束：
 * - 不打印 token / 完整手机号
 * - 账号文件写入 tools/simulator/.runtime/accounts.json，权限 600
 * - 每 5 个账号等待 60 秒，避免 OTP IP 限流
 * - 只探测渠道，不自动创建渠道；不调用任何 confirm 接口
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { apiUrl, loadConfig } from "./config.mjs";

export const BATCH_SIZE = 5;
export const BATCH_WAIT_MS = 60_000;
export const ACCOUNTS_FILE = "accounts.json";
export const USER_AGENT = "JoyMiniSimulator/1.0 (+synthetic-traffic)";
const MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 30_000;

export class SimulatorHttpError extends Error {
  constructor({ method, route, status, code, message, retryAfterMs, cause }) {
    super(buildErrorMessage({ method, route, status, code, message }), {
      cause,
    });
    this.name = "SimulatorHttpError";
    this.method = method;
    this.route = route;
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export class ChannelProbeError extends Error {
  constructor(message) {
    super(message);
    this.name = "ChannelProbeError";
  }
}

function buildErrorMessage({ method, route, status, code, message }) {
  const parts = [`${method} ${route} 失败`];
  if (status) parts.push(`HTTP ${status}`);
  if (code !== undefined && code !== null) parts.push(`code ${code}`);
  if (message) parts.push(String(message));

  let text = redactSecrets(parts.join("："));
  if (status === 403 && /csrf/i.test(String(message ?? ""))) {
    text +=
      "（若后端把 CSRF 中间件注册在 cookieParser 之前，cookie 永远读不到；" +
      "需后端修复顺序或将 /v1/otp 加入 CSRF 跳过列表。模拟器不会绕过 CSRF。）";
  }
  return text;
}

/** 日志/错误里去掉手机号、JWT、token 字段。 */
export function redactSecrets(value) {
  return String(value)
    .replace(
      /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g,
      "[redacted-token]",
    )
    .replace(/(?:\+?\d[\d\s-]{9,}\d)/g, (match) =>
      match.replace(/\D/g, "").length >= 10 ? "[redacted-number]" : match,
    )
    .replace(
      /(accessToken|refreshToken|token)\s*[=:]\s*[^\s,;)]+/gi,
      "$1=[redacted]",
    );
}

/** 只保留国家/运营商前缀，日志里永远不出现完整手机号。 */
export function maskPhone(phone) {
  const text = String(phone);
  if (text.length <= 6) return "+63****";
  return `${text.slice(0, 6)}****`;
}

/** 生成 PH 手机号：+63917 + 7 位数字。 */
export function generatePhone(rng = Math.random) {
  const suffix = String(Math.floor(rng() * 10_000_000)).padStart(7, "0");
  return `+63917${suffix}`;
}

function generateUniquePhone(rng, used) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const phone = generatePhone(rng);
    if (!used.has(phone)) {
      used.add(phone);
      return phone;
    }
  }
  throw new Error("无法生成唯一手机号，请重试");
}

/** 每个账号独立 deviceId：sim-<phone>-<random>。 */
export function createDeviceId(phone, rng = Math.random) {
  let suffix = "";
  for (let i = 0; i < 8; i += 1) {
    suffix += Math.floor(rng() * 16).toString(16);
  }
  return `sim-${phone}-${suffix}`;
}

export function accountsPath(runtimeDir) {
  return path.join(runtimeDir, ACCOUNTS_FILE);
}

const ACCOUNT_FIELDS = ["phone", "userId", "token", "refreshToken", "deviceId"];

/** 读取 accounts.json；文件不存在时返回空数组。 */
export function loadAccounts(runtimeDir) {
  const file = accountsPath(runtimeDir);
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${file} 不是合法 JSON：${redactSecrets(error.message)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${file} 必须是账号数组`);
  }

  parsed.forEach((account, index) => {
    const invalid =
      !account ||
      typeof account !== "object" ||
      ACCOUNT_FIELDS.some(
        (field) => typeof account[field] !== "string" || !account[field],
      );
    if (invalid) {
      throw new Error(
        `${file} 第 ${index + 1} 个账号缺少 ${ACCOUNT_FIELDS.join("/")} 字段`,
      );
    }
  });

  return parsed.map(({ phone, userId, token, refreshToken, deviceId }) => ({
    phone,
    userId,
    token,
    refreshToken,
    deviceId,
  }));
}

/** 原子写入 accounts.json，目录 700、文件 600。 */
export function saveAccounts(runtimeDir, accounts) {
  fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(runtimeDir, 0o700);
  } catch {
    // 某些文件系统不支持 chmod；不阻断 provisioning。
  }

  const target = accountsPath(runtimeDir);
  const tmp = `${target}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(accounts, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);
  fs.chmodSync(target, 0o600);
  return target;
}

function getSetCookies(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const raw = headers.get("set-cookie");
  return raw ? [raw] : [];
}

function parseRetryAfter(headers) {
  const raw = headers.get?.("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(raw);
  if (Number.isFinite(date)) {
    return Math.max(0, date - Date.now());
  }
  return undefined;
}

async function requestJson({
  config,
  route,
  method = "GET",
  token,
  body,
  csrf,
  deviceId,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const url = apiUrl(config, route);
  const headers = {
    accept: "application/json",
    "user-agent": USER_AGENT,
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  if (deviceId) {
    headers["x-device-id"] = deviceId;
    headers["x-device-model"] = "sim-headless";
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
    throw new SimulatorHttpError({
      method,
      route,
      cause: error,
      message: redactSecrets(error?.message ?? String(error)),
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
    throw new SimulatorHttpError({
      method,
      route,
      status: response.status,
      code: payload?.code,
      message: payload?.message,
      retryAfterMs: parseRetryAfter(response.headers),
    });
  }

  // 统一响应壳：{ code, message, tid, data }
  if (payload && typeof payload === "object" && "code" in payload) {
    if (payload.code !== 10000) {
      throw new SimulatorHttpError({
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
 * 通过一个安全的 GET 获取后端下发的 CSRF cookie/header。
 * 这里只走正规握手，不伪造、不绕过 CSRF。
 */
export async function fetchCsrfToken(
  config,
  { fetchImpl = globalThis.fetch } = {},
) {
  const route = "/health";
  const response = await fetchImpl(apiUrl(config, route), {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });

  let token = response.headers.get("x-csrf-token") ?? "";
  let cookie = "";
  for (const raw of getSetCookies(response.headers)) {
    const pair = String(raw).split(";")[0].trim();
    if (pair.startsWith("csrf_token=")) {
      cookie = pair;
      token = token || pair.slice("csrf_token=".length);
    }
  }
  if (!token) return null;
  return { token, cookie: cookie || `csrf_token=${token}` };
}

function retryDelayMs(error, attempt) {
  if (error?.retryAfterMs && error.retryAfterMs > 0) {
    return error.retryAfterMs;
  }
  return Math.min(60_000, 1000 * 2 ** attempt);
}

async function createAccountWithRetry({
  phone,
  deviceId,
  config,
  csrf,
  fetchImpl,
  sleep,
  logger,
}) {
  let step = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const base = {
        config,
        method: "POST",
        csrf,
        deviceId,
        fetchImpl,
      };

      if (step < 1) {
        await requestJson({
          ...base,
          route: "/v1/otp/request",
          body: { phone },
        });
        step = 1;
      }
      if (step < 2) {
        await requestJson({
          ...base,
          route: "/v1/otp/verify",
          body: { phone, code: config.otpCode },
        });
        step = 2;
      }

      const data = await requestJson({
        ...base,
        route: "/v1/auth/login/otp",
        body: { phone },
      });
      const token = data?.tokens?.accessToken;
      const refreshToken = data?.tokens?.refreshToken;
      const userId = data?.user?.id ?? data?.id;
      if (!token || !refreshToken || !userId) {
        throw new Error(
          "登录响应缺少 tokens.accessToken / tokens.refreshToken 或 user.id",
        );
      }

      return { phone, userId, token, refreshToken, deviceId };
    } catch (error) {
      const retryable =
        error instanceof SimulatorHttpError &&
        (error.status === 429 || error.status >= 500);
      if (!retryable || attempt === MAX_ATTEMPTS) throw error;

      const waitMs = retryDelayMs(error, attempt);
      logger.warn(
        `建号请求遇到 HTTP ${error.status}，${Math.ceil(waitMs / 1000)} 秒后重试（第 ${attempt + 1}/${MAX_ATTEMPTS} 次）`,
      );
      await sleep(waitMs);
    }
  }

  throw new Error("建号重试次数耗尽");
}

/**
 * 用 refreshToken 换取新的 accessToken / refreshToken。
 * 长期运行时 access token 会过期；runner 应在 401 时刷新并把结果写回 accounts.json。
 */
export async function refreshAccountToken(
  config,
  account,
  { fetchImpl = globalThis.fetch, timeoutMs } = {},
) {
  if (!account?.refreshToken) {
    throw new Error("账号缺少 refreshToken，无法刷新 token");
  }

  const data = await requestJson({
    config,
    route: "/v1/auth/refresh",
    method: "POST",
    body: { refreshToken: account.refreshToken },
    deviceId: account.deviceId,
    fetchImpl,
    timeoutMs,
  });

  // 后端返回 { tokens: { accessToken, refreshToken } }
  const tokens = data?.tokens ?? data;
  const token = tokens?.accessToken;
  const refreshToken = tokens?.refreshToken ?? account.refreshToken;
  if (!token) {
    throw new Error("刷新 token 响应缺少 accessToken");
  }

  return { ...account, token, refreshToken };
}

/**
 * 批量创建账号（不负责渠道探测）。成功后逐条回调 onAccount，方便 CLI 增量落盘。
 */
export async function provisionAccounts({
  count,
  startIndex = 0,
  config = loadConfig(),
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  rng = Math.random,
  logger = console,
  onAccount = null,
  excludePhones = new Set(),
  csrf = undefined,
  batchSize = BATCH_SIZE,
  batchWaitMs = BATCH_WAIT_MS,
} = {}) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`count 必须是正整数，收到 ${count}`);
  }
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error(`batchSize 必须是正整数，收到 ${batchSize}`);
  }

  let activeCsrf = csrf;
  if (activeCsrf === undefined) {
    activeCsrf = await fetchCsrfToken(config, { fetchImpl });
  }
  if (activeCsrf === null) {
    logger.warn(
      "未能从 GET /health 获取 CSRF token；若后端启用 CSRF，OTP POST 会被拒绝。",
    );
  }

  const usedPhones = new Set(excludePhones);
  const accounts = [];

  for (let produced = 0; produced < count; produced += 1) {
    const phone = generateUniquePhone(rng, usedPhones);
    const deviceId = createDeviceId(phone, rng);
    const account = await createAccountWithRetry({
      phone,
      deviceId,
      config,
      csrf: activeCsrf,
      fetchImpl,
      sleep,
      logger,
    });

    accounts.push(account);
    logger.log(
      `账号 #${startIndex + produced + 1} 创建成功（${produced + 1}/${count}）`,
    );
    if (onAccount) {
      await onAccount(account, {
        index: startIndex + produced,
        produced: produced + 1,
      });
    }

    const hasMore = produced + 1 < count;
    if (hasMore && (produced + 1) % batchSize === 0) {
      const waitSeconds = Math.round(batchWaitMs / 1000);
      logger.log(
        `已完成 ${produced + 1}/${count}，等待 ${waitSeconds} 秒以避免 OTP 限流…`,
      );
      await sleep(batchWaitMs);
    }
  }

  return accounts;
}

/**
 * 用账号 token 探测渠道是否存在。
 * 该 GET 在渠道正常时会创建/复用客服会话；404/403 提示先创建渠道，绝不自动创建。
 */
export async function probeChannel(
  config,
  token,
  { fetchImpl = globalThis.fetch, deviceId, timeoutMs } = {},
) {
  const route = `/v1/chat/business?businessId=${encodeURIComponent(config.businessId)}`;

  try {
    const data = await requestJson({
      config,
      route,
      token,
      deviceId,
      fetchImpl,
      timeoutMs,
    });
    if (!data?.conversationId) {
      throw new ChannelProbeError(
        `渠道 ${config.businessId} 探测返回异常：缺少 conversationId`,
      );
    }
    return data.conversationId;
  } catch (error) {
    if (error instanceof SimulatorHttpError) {
      if (error.status === 404 || error.status === 403) {
        throw new ChannelProbeError(
          `渠道 ${config.businessId} 不存在、未启用或当前账号无权访问（HTTP ${error.status}）。` +
            "请先在 admin 后台 /support-channels 创建并启用该渠道；脚本不会自动创建。",
        );
      }
      if (error.status === 401) {
        throw new ChannelProbeError(
          "渠道探测失败：账号 token 无效或已过期（HTTP 401）。" +
            "请删除 tools/simulator/.runtime/accounts.json 或使用 --replace 重新建号。",
        );
      }
    }
    throw error;
  }
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
    count: undefined,
    startIndex: undefined,
    dryRun: false,
    skipChannelCheck: false,
    replace: false,
    help: false,
    batchSize: undefined,
    batchWaitMs: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const readValue = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} 缺少参数值`);
      return argv[i];
    };

    switch (arg) {
      case "--count":
        options.count = parseCliInt(arg, readValue(), { min: 1, max: 100 });
        break;
      case "--start-index":
        options.startIndex = parseCliInt(arg, readValue(), {
          min: 0,
          max: 1_000_000,
        });
        break;
      case "--batch-size":
        options.batchSize = parseCliInt(arg, readValue(), { min: 1, max: 100 });
        break;
      case "--batch-wait-ms":
        options.batchWaitMs = parseCliInt(arg, readValue(), {
          min: 0,
          max: 600_000,
        });
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--skip-channel-check":
        options.skipChannelCheck = true;
        break;
      case "--replace":
        options.replace = true;
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
  write(`用法：node tools/simulator/provision.mjs [options]

选项：
  --count <n>             新账号数量（默认 SIM_ACCOUNT_COUNT=30）
  --start-index <n>       账号编号起点（默认沿用已有账号数）
  --dry-run               只生成计划，不联网、不写文件
  --replace               忽略已有 accounts.json，重新建号（不会删除服务端用户）
  --skip-channel-check    跳过 /chat/business 渠道探测
  --batch-size <n>        每批账号数（默认 5）
  --batch-wait-ms <ms>    批间隔（默认 60000）
  -h, --help              显示本帮助

环境变量：
  SIM_API_BASE_URL        API 根地址，默认 https://api.joyminis.com/api
  SIM_SOCKET_URL          Socket 地址，默认 https://api.joyminis.com/events
  SIM_BUSINESS_ID         渠道 ID，默认 simulation_support_v1
  SIM_ACCOUNT_COUNT       默认账号数，默认 30
  SIM_CONCURRENCY         并发（1-5），默认 5
  SIM_OTP_CODE            固定 OTP，默认 999999
  SIM_RUNTIME_DIR         运行态目录，默认 tools/simulator/.runtime
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

  const count = options.count ?? config.accountCount;
  const startIndex = options.startIndex ?? 0;

  if (options.dryRun) {
    const rng = deps.rng ?? Math.random;
    const used = new Set();
    logger.log(
      `[dry-run] 将创建 ${count} 个账号（不联网、不写文件；startIndex=${startIndex}）`,
    );
    for (let i = 0; i < count; i += 1) {
      const phone = generateUniquePhone(rng, used);
      logger.log(`  #${startIndex + i + 1} ${maskPhone(phone)}`);
    }
    return 0;
  }

  if (options.skipChannelCheck) {
    logger.warn(
      `警告：已使用 --skip-channel-check，跳过渠道 ${config.businessId} 存在性探测；` +
        "请自行确认该渠道已在 admin /support-channels 创建并启用。",
    );
  }

  const existing = options.replace ? [] : loadAccounts(config.runtimeDir);
  let merged = [...existing];
  const knownPhones = new Set(merged.map((account) => account.phone));

  let channelChecked = false;
  if (existing.length > 0 && !options.skipChannelCheck) {
    logger.log(`使用已有账号探测渠道 ${config.businessId}…`);
    await probeChannel(config, existing[0].token, {
      deviceId: existing[0].deviceId,
      fetchImpl: deps.fetchImpl,
    });
    channelChecked = true;
    logger.log("渠道探测通过。");
  }

  logger.log(
    `开始建号：新增 ${count} 个（已有 ${existing.length} 个），batchSize=${options.batchSize ?? BATCH_SIZE}`,
  );

  const accounts = await provisionAccounts({
    count,
    startIndex: options.startIndex ?? existing.length,
    config,
    fetchImpl: deps.fetchImpl,
    sleep: deps.sleep,
    rng: deps.rng,
    logger,
    excludePhones: knownPhones,
    batchSize: options.batchSize ?? BATCH_SIZE,
    batchWaitMs: options.batchWaitMs ?? BATCH_WAIT_MS,
    onAccount: async (account) => {
      merged = [...merged, account];
      saveAccounts(config.runtimeDir, merged);

      if (!channelChecked && !options.skipChannelCheck) {
        channelChecked = true;
        await probeChannel(config, account.token, {
          deviceId: account.deviceId,
          fetchImpl: deps.fetchImpl,
        });
        logger.log("渠道探测通过。");
      }
    },
  });

  logger.log(
    `建号完成：新增 ${accounts.length} 个，累计 ${merged.length} 个。`,
  );
  logger.log(`账号文件：${accountsPath(config.runtimeDir)}（权限 600）`);
  return 0;
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  main()
    .then((code) => {
      process.exitCode = code ?? 0;
    })
    .catch((error) => {
      // 只输出脱敏后的 message，避免把请求体/凭据带进日志。
      console.error(redactSecrets(error?.message ?? String(error)));
      process.exitCode = 1;
    });
}
