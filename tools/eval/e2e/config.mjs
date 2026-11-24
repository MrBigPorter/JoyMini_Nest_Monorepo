/**
 * 端到端验收测试的配置。
 *
 * 与 tools/simulator/config.mjs 的区别：
 * - 模拟器默认指向生产专用渠道；这里默认只允许本机 dev，必须显式
 *   E2E_ALLOW_REMOTE=1 才允许指向别的地址，避免误把真实账号打到线上。
 * - 多了「HTTP 每分钟发送上限」：走 /chat/message 的 HTTP 路径受全局
 *   60 次/分/IP 的 throttler 限制，脚本必须自己节流。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

export const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(E2E_DIR, "../../..");

/** 相对路径按工具目录解析，保证落盘永远在 tools/eval/e2e/ 下（已 gitignore）。 */
function resolveToolPath(value) {
  return path.isAbsolute(value) ? value : path.join(E2E_DIR, value);
}

export const DEFAULTS = Object.freeze({  apiBaseUrl: "http://localhost:3000/api",
  socketUrl: "http://localhost:3000/events",
  businessId: "simulation_support_v1",
  trafficSource: "e2e_acceptance_v1",
  accountCount: 12,
  concurrency: 4,
  httpPerMinute: 50,
  otpCode: "999999",
  replyTimeoutMs: 90_000,
  actionTimeoutMs: 60_000,
  judgeConcurrency: 5,
});

const MAX_ACCOUNT_COUNT = 40;
const MAX_CONCURRENCY = 8;

function envText(env, key) {
  const raw = env[key];
  return raw === undefined || raw === null ? "" : String(raw).trim();
}

function parseInteger(env, key, fallback, { min, max }) {
  const text = envText(env, key);
  if (!text) return fallback;
  if (!/^\d+$/.test(text)) {
    throw new Error(`${key} must be an integer, got "${text}"`);
  }
  const value = Number(text);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be between ${min} and ${max}, got ${value}`);
  }
  return value;
}

function parseHttpUrl(value, fallback, key) {
  const text = (value || fallback || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^/\s]+/i.test(text)) {
    throw new Error(`${key} must be an http(s) URL, got "${text}"`);
  }
  return text;
}

function parseNonEmpty(value, fallback, key) {
  const text = (value || fallback || "").trim();
  if (!text) throw new Error(`${key} must not be empty`);
  return text;
}

function isLocalHost(urlText) {
  const host = new URL(urlText).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function parseCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * 读取配置。所有值都可以用 E2E_* 覆盖；默认只允许本机。
 */
export function loadConfig(env = process.env) {
  const apiBaseUrl = parseHttpUrl(
    envText(env, "E2E_API_BASE_URL"),
    DEFAULTS.apiBaseUrl,
    "E2E_API_BASE_URL",
  );
  const socketUrl = parseHttpUrl(
    envText(env, "E2E_SOCKET_URL"),
    DEFAULTS.socketUrl,
    "E2E_SOCKET_URL",
  );
  const allowRemote = envText(env, "E2E_ALLOW_REMOTE") === "1";
  if (!allowRemote && (!isLocalHost(apiBaseUrl) || !isLocalHost(socketUrl))) {
    throw new Error(
      `E2E 默认只允许本机地址；如果要跑远端，显式设置 E2E_ALLOW_REMOTE=1。（当前 ${apiBaseUrl} / ${socketUrl}）`,
    );
  }

  const otpCode = parseNonEmpty(envText(env, "E2E_OTP_CODE"), DEFAULTS.otpCode, "E2E_OTP_CODE");
  if (!/^\d{4,8}$/.test(otpCode)) {
    throw new Error(`E2E_OTP_CODE must be 4-8 digits, got "${otpCode}"`);
  }

  const skip = new Set(parseCsv(envText(env, "E2E_SKIP")).map((item) => item.toLowerCase()));
  const actions = parseCsv(envText(env, "E2E_ACTIONS"));
  const kinds = parseCsv(envText(env, "E2E_KINDS")).map((item) => item.toLowerCase());
  const scope = envText(env, "E2E_SCOPE").toLowerCase() || "full";
  if (scope !== "full" && scope !== "subset") {
    throw new Error(`E2E_SCOPE must be full or subset, got "${scope}"`);
  }
  const docIds = parseCsv(envText(env, "E2E_DOC_IDS"));
  if (scope === "subset" && docIds.length === 0) {
    throw new Error("E2E_SCOPE=subset 需要 E2E_DOC_IDS（受影响文档 docId，逗号分隔）");
  }
  // 子集只跑知识与多轮：动作/读类/边界与知识文档没有可靠映射。
  const subsetKinds = ["knowledge", "multi"];
  if (scope === "subset" && kinds.length === 0) kinds.push(...subsetKinds);

  return {
    apiBaseUrl,
    socketUrl,
    businessId: parseNonEmpty(envText(env, "E2E_BUSINESS_ID"), DEFAULTS.businessId, "E2E_BUSINESS_ID"),
    trafficSource: parseNonEmpty(
      envText(env, "E2E_TRAFFIC_SOURCE"),
      DEFAULTS.trafficSource,
      "E2E_TRAFFIC_SOURCE",
    ),
    accountCount: parseInteger(env, "E2E_ACCOUNT_COUNT", DEFAULTS.accountCount, {
      min: 1,
      max: MAX_ACCOUNT_COUNT,
    }),
    /** 前置业务数据建在几个账号上（动作/读类/边界用例轮转到这些账号） */
    fixtureAccounts: parseInteger(env, "E2E_FIXTURE_ACCOUNTS", 3, {
      min: 1,
      max: MAX_ACCOUNT_COUNT,
    }),
    /**
     * 从账号池第几个开始挑 fixture 账号。默认 0（池里前 N 个）。
     * 某些账号当日 AI 配额已烧完时，用 offset 换一批没被知识题用过的账号。
     */
    fixtureAccountOffset: parseInteger(env, "E2E_FIXTURE_ACCOUNT_OFFSET", 0, {
      min: 0,
      max: MAX_ACCOUNT_COUNT - 1,
    }),
    concurrency: parseInteger(env, "E2E_CONCURRENCY", DEFAULTS.concurrency, {
      min: 1,
      max: MAX_CONCURRENCY,
    }),
    httpPerMinute: parseInteger(env, "E2E_HTTP_PER_MINUTE", DEFAULTS.httpPerMinute, {
      min: 5,
      max: 55,
    }),
    otpCode,
    replyTimeoutMs: parseInteger(env, "E2E_REPLY_TIMEOUT_MS", DEFAULTS.replyTimeoutMs, {
      min: 5_000,
      max: 300_000,
    }),
    actionTimeoutMs: parseInteger(env, "E2E_ACTION_TIMEOUT_MS", DEFAULTS.actionTimeoutMs, {
      min: 5_000,
      max: 300_000,
    }),
    judgeConcurrency: parseInteger(env, "E2E_JUDGE_CONCURRENCY", DEFAULTS.judgeConcurrency, {
      min: 1,
      max: 10,
    }),
    knowledgeLimit: parseInteger(env, "E2E_LIMIT", 0, { min: 0, max: 10_000 }),
    multiLimit: parseInteger(env, "E2E_MULTI_LIMIT", 0, { min: 0, max: 1_000 }),
    actions: actions.length > 0 ? actions : null,
    /** 只跑指定类别（knowledge/multi/action/read/boundary）；空 = 全跑 */
    kinds: kinds.length > 0 ? kinds : null,
    /** 运行范围：full=全量，subset=按 E2E_DOC_IDS 过滤后的子集（不得 promote） */
    scope,
    /** 受影响文档 docId；子集映射的输入（与上次全量快照取交集） */
    docIds,
    /** 指向上一次全量运行；子集用例快照从它的 datasetSnapshot.cases 取 */
    baseRunId: envText(env, "E2E_BASE_RUN_ID") || null,
    /** 子集是否纳入负样本（新文档上线时手动打开） */
    includeNegatives: envText(env, "E2E_INCLUDE_NEGATIVES") === "1",
    /** E2E_RESUME=1 时复用 .runtime/cases/ 里已完成的用例结果 */
    resume: envText(env, "E2E_RESUME") === "1",
    skip,
    runtimeDir: envText(env, "E2E_RUNTIME_DIR")
      ? resolveToolPath(envText(env, "E2E_RUNTIME_DIR"))
      : path.join(E2E_DIR, ".runtime"),
    reportsDir: envText(env, "E2E_REPORTS_DIR")
      ? resolveToolPath(envText(env, "E2E_REPORTS_DIR"))
      : path.join(E2E_DIR, "reports"),
  };
}

/** 把 `/v1/...` 拼到 apiBaseUrl（默认已包含 `/api`）后面。 */
export function apiUrl(config, pathname) {
  const base = String(config.apiBaseUrl).replace(/\/+$/, "");
  const suffix = String(pathname).startsWith("/") ? pathname : `/${pathname}`;
  return `${base}${suffix}`;
}
