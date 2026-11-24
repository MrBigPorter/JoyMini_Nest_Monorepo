/**
 * 管理员侧操作（仅 dev）：
 * - 关会话、切回 AI 模式（保证每道题一个干净会话）
 * - 券续期 / 建兑换码券、KYC 审批、余额充值（业务动作前置数据）
 * - RAG 忠实度 judge、任务 judge、文档 chunk（判定与证据）
 *
 * 令牌来源按优先级：
 *   1. E2E_ADMIN_TOKEN（CI 显式注入）
 *   2. POST /v1/auth/admin/test-login（读后端容器 env 的测试凭据）
 *   3. 本地签一个 SUPER_ADMIN JWT（读容器 env 的密钥 + DB 里已存在的
 *      SUPER_ADMIN id）。dev 的测试凭据与 admin_users 行不一致时
 *      只能走这条；密钥/令牌只在内存里，绝不打印、绝不写报告。
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";

import { E2EHttpError, requestJson, withRetry } from "./http.mjs";

export const DEFAULT_BACKEND_CONTAINER = "lucky-backend-dev";
export const DEFAULT_DB_CONTAINER = "lucky-db";
export const DEFAULT_DB_NAME = "joy_mini";

/** HS256 JWT 签名（无第三方依赖；与后端 jsonwebtoken.verify 兼容） */
export function signAdminJwt({
  secret,
  sub,
  role = "SUPER_ADMIN",
  username = "e2e-runner",
  ttlSec = 2 * 60 * 60,
  now = Date.now(),
}) {
  if (!secret) throw new Error("secret 不能为空");
  if (!sub) throw new Error("sub 不能为空");
  const issuedAt = Math.floor(now / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub,
      role,
      type: "admin",
      username,
      iat: issuedAt,
      exp: issuedAt + ttlSec,
    }),
  ).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

function containerEnv(container, key) {
  try {
    const value = execFileSync("docker", ["exec", container, "printenv", key], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

/** 读容器里**非敏感**的配置值（报告头用，例如 AI_LLM_TYPE）。 */
export function readBackendEnv(key) {
  const container = process.env.E2E_BACKEND_CONTAINER || DEFAULT_BACKEND_CONTAINER;
  return containerEnv(container, key);
}

function superAdminId(dbContainer, dbName) {
  const sql =
    "select admin_id from admin_users " +
    "where role = 'SUPER_ADMIN' and status = 1 and deleted_at is null " +
    "order by created_at asc limit 1";
  const value = execFileSync(
    "docker",
    ["exec", dbContainer, "psql", "-U", "postgres", "-d", dbName, "-tAc", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
  if (!value) {
    throw new Error("找不到可用的 SUPER_ADMIN 账号，无法为 E2E 签发管理员令牌");
  }
  return value;
}

/**
 * 只读查库（核验副作用 / 关联观测数据）。
 *
 * 强制 `default_transaction_read_only = on`，SQL 走 stdin 而不是 shell 拼接；
 * 调用方负责先校验拼进 SQL 的 id。
 */
export function queryDbRows(
  sql,
  {
    dbContainer = process.env.E2E_DB_CONTAINER || DEFAULT_DB_CONTAINER,
    dbName = process.env.E2E_DB_NAME || DEFAULT_DB_NAME,
    exec = execFileSync,
  } = {},
) {
  return exec(
    "docker",
    [
      "exec",
      "-i",
      dbContainer,
      "psql",
      "-U",
      "postgres",
      "-d",
      dbName,
      "-v",
      "ON_ERROR_STOP=1",
      "-tA",
    ],
    {
      input: `SET default_transaction_read_only = on;\n${sql}\n`,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    },
  );
}

/**
 * 解析管理员令牌。失败信息只说「哪条路失败」，不带任何密钥/凭据。
 */
export async function resolveAdminToken(config, { logger = console, fetchImpl } = {}) {
  if (process.env.E2E_ADMIN_TOKEN) {
    return { token: process.env.E2E_ADMIN_TOKEN, source: "env" };
  }

  const backend =
    process.env.E2E_BACKEND_CONTAINER || DEFAULT_BACKEND_CONTAINER;
  const dbContainer = process.env.E2E_DB_CONTAINER || DEFAULT_DB_CONTAINER;
  const dbName = process.env.E2E_DB_NAME || DEFAULT_DB_NAME;

  const username = containerEnv(backend, "ADMIN_TEST_USERNAME");
  const code = containerEnv(backend, "ADMIN_TEST_CODE");
  if (username && code) {
    try {
      const data = await requestJson({
        config,
        route: "/v1/auth/admin/test-login",
        method: "POST",
        body: { test: username, code },
        fetchImpl,
        timeoutMs: 15_000,
      });
      const token = data?.tokens?.accessToken;
      if (token) return { token, source: "test-login" };
      logger.warn("admin test-login 成功但响应里没有 accessToken，改用本地签发");
    } catch (error) {
      const reason =
        error instanceof E2EHttpError ? `HTTP ${error.status ?? "?"}` : "网络错误";
      logger.warn(`admin test-login 不可用（${reason}），改用本地 SUPER_ADMIN 签发`);
    }
  } else {
    logger.warn("后端容器未配置 ADMIN_TEST_USERNAME/ADMIN_TEST_CODE，改用本地签发");
  }

  const secret =
    containerEnv(backend, "ADMIN_JWT_SECRET") ||
    containerEnv(backend, "JWT_SECRET");
  if (!secret) {
    throw new Error(
      "无法从后端容器读取 ADMIN_JWT_SECRET/JWT_SECRET；" +
        "请设置 E2E_ADMIN_TOKEN 或确认容器名（E2E_BACKEND_CONTAINER）",
    );
  }
  const sub = superAdminId(dbContainer, dbName);
  return {
    token: signAdminJwt({ secret, sub }),
    source: "signed-super-admin",
  };
}

/**
 * 管理员 API 客户端；令牌懒加载，只暴露业务方法。
 *
 * `throttle` / `stats` 与客户端 HTTP 共用同一个实例：后端的全局限流是
 * 「60 次/分/IP」，client、admin、judge 三类请求一起算，否则各自
 * 节流仍会撞到上限。
 */
export function createAdminApi(
  config,
  { logger = console, fetchImpl, throttle = null, stats = null } = {},
) {
  let tokenPromise = null;
  let cachedDocs = null;

  const token = () => {
    tokenPromise ??= resolveAdminToken(config, { logger, fetchImpl });
    return tokenPromise;
  };

  async function request(route, options = {}) {
    const { token: adminToken } = await token();
    return withRetry(
      async () => {
        if (throttle) {
          await throttle.acquire();
          if (stats) stats.requests += 1;
        }
        try {
          return await requestJson({
            config,
            route,
            token: adminToken,
            fetchImpl,
            timeoutMs: 90_000,
            ...options,
          });
        } catch (error) {
          if (error?.status === 429 && stats) stats.throttled += 1;
          throw error;
        }
      },
      {
        attempts: 3,
        onRetry: () => {
          if (stats) stats.retries += 1;
        },
      },
    );
  }

  return {
    request,
    async whoami() {
      return (await token()).source;
    },

    // ── 会话控制 ──────────────────────────────────────────────
    closeConversation(conversationId, reason = "e2e: rotate conversation") {
      return request(
        `/v1/admin/chat/conversations/${encodeURIComponent(conversationId)}/close`,
        { method: "PATCH", body: { reason } },
      );
    },

    /** 会话被人工认领时，把处理者切回 AI（否则 AI 会静默不回） */
    setAiMode(conversationId) {
      return request(
        `/v1/admin/chat/conversations/${encodeURIComponent(conversationId)}/handler`,
        { method: "PATCH", body: { mode: "ai" } },
      );
    },

    // ── 券 ────────────────────────────────────────────────────
    listCoupons({ page = 1, pageSize = 100, keyword } = {}) {
      const query = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (keyword) query.set("keyword", keyword);
      return request(`/v1/admin/coupons/list?${query.toString()}`);
    },

    updateCoupon(couponId, patch) {
      return request(`/v1/admin/coupons/${encodeURIComponent(couponId)}`, {
        method: "PATCH",
        body: patch,
      });
    },

    createCoupon(dto) {
      return request("/v1/admin/coupons/create", {
        method: "POST",
        body: dto,
      });
    },

    // ── KYC / 余额 ────────────────────────────────────────────
    createKyc({ userId, realName, idNumber, idType = 1, remark }) {
      return request("/v1/admin/kyc/create", {
        method: "POST",
        body: { userId, realName, idNumber, idType, remark },
      });
    },

    adjustBalance({ userId, actionType, balanceType, amount, remark }) {
      return request("/v1/admin/finance/adjust", {
        method: "POST",
        body: { userId, actionType, balanceType, amount, remark },
      });
    },

    // ── 判定 / 证据 ───────────────────────────────────────────
    judgeFaithfulness({ question, answer, sources }) {
      return request("/v1/admin/rag/documents/judge", {
        method: "POST",
        body: { question, answer, sources },
      });
    },

    judgeTask({ question, answer, expectTask, pendingConfirm = null }) {
      return request("/v1/admin/ai-eval/judge", {
        method: "POST",
        body: { question, answer, expectTask, pendingConfirm },
      });
    },

    // ── 评测运行记录（评测闭环 · EXTERNAL）──────────────────────
    /** 创建一次外部运行，返回 AiEvalRun（含 id）。 */
    createExternalEvalRun(payload) {
      return request("/v1/admin/ai-eval/runs/external", {
        method: "POST",
        body: payload,
      });
    },

    /** 写入结果并收尾；结果只能写一次。 */
    ingestExternalEvalResults(runId, payload) {
      return request(
        `/v1/admin/ai-eval/runs/${encodeURIComponent(runId)}/external-results`,
        { method: "POST", body: payload },
      );
    },

    /** 收尾为 FAILED（结果写入失败时尽力标脏，避免留一条永久 RUNNING）。 */
    failExternalEvalRun(runId, error) {
      return request(
        `/v1/admin/ai-eval/runs/${encodeURIComponent(runId)}/external-results`,
        {
          method: "POST",
          body: { cases: [], status: "FAILED", error: String(error).slice(0, 300) },
        },
      );
    },

    /** 全量文档列表（27 份，一次拉完做 docId → UUID 映射） */
    async listDocuments() {
      if (cachedDocs) return cachedDocs;
      const data = await request(
        "/v1/admin/rag/documents?page=1&pageSize=100",
      );
      cachedDocs = Array.isArray(data?.list) ? data.list : [];
      return cachedDocs;
    },

    async documentUuid(docId) {
      const docs = await this.listDocuments();
      const match = docs.find((doc) => doc.docId === docId);
      return match?.id ?? null;
    },

    getDocChunks(documentUuid) {
      return request(
        `/v1/admin/rag/documents/${encodeURIComponent(documentUuid)}/chunks`,
      );
    },

    /** 按 docId 直接取 chunk 文本（找不到返回空数组） */
    async getChunksByDocId(docId) {
      const uuid = await this.documentUuid(docId);
      if (!uuid) return [];
      const chunks = await this.getDocChunks(uuid);
      return Array.isArray(chunks) ? chunks : [];
    },
  };
}
