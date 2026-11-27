/**
 * 真实账号端到端 AI 客服验收 —— 编排入口。
 *
 *   node tools/eval/e2e/run.mjs
 *
 * 流程：
 *   预检（健康 / 管理员令牌 / judge 冒烟 / 题库）
 *   → 真实 OTP 账号池
 *   → 产品接口造前置数据（fixtures）
 *   → 知识 / 多轮 / 业务动作 / 读类 / 边界 用例
 *   → LLM 判定（回答自带的 sources，不查库统计）
 *   → reports/<ts>/summary.md + detail.json
 *
 * 每例结果单独落盘（.runtime/cases/），E2E_RESUME=1 可断点续跑。
 * 用例之间关单轮换会话；所有 HTTP（客户端 / admin / judge）共用
 * 一个节流器，对齐后端「60 次/分/IP」的全局限流。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  REPO_ROOT,
  loadConfig,
} from "./config.mjs";
import { createHttpTransport } from "./http.mjs";
import {
  ensureAccounts,
  maskPhone,
  resolveOtpCode,
  saveAccounts,
} from "./provision.mjs";
import { createAdminApi, readBackendEnv } from "./admin.mjs";
import { confirmReplyFor, createAnswerDriver } from "./answers.mjs";
import { createClientSession } from "./client.mjs";
import {
  GOLDEN_FILES,
  buildActionCases,
  buildBoundaryCases,
  buildKnowledgeCases,
  buildReadCases,
  filterCasesToSubset,
  loadGoldens,
  pairMultiTurn,
  selectSubsetFromFullRun,
} from "./cases.mjs";
import { prepareFixtures } from "./fixtures.mjs";
import {
  citedDocIdsFor,
  fingerprint,
  judgeActionCase,
  judgeBoundaryCase,
  judgeGoldenAgreement,
  judgeKnowledgeCase,
  judgeReadCase,
  similarity,
} from "./judge.mjs";
import { writeReport } from "./report.mjs";
import {
  applyGrounding,
  collectMessageIds,
  loadGrounding,
} from "./traces.mjs";
import {
  HARNESS_METRIC_SPEC_VERSION,
  buildExternalSnapshot,
  buildKnowledgeCreateFields,
  buildKnowledgeIngestFields,
  compareSummaryWithRecord,
  readServerCommitSha,
  summarizeExternalResults,
  toExternalResult,
} from "./external-sync.mjs";

const CASE_DIR_NAME = "cases";
const MULTI_PAIR_DEFAULT = 20;

/** 后端 AI 配额耗尽时的兜底话术（日配额 / 会话配额共用同一句）。 */
export function isQuotaReply(text) {
  return /AI 使用上限|Daily AI token limit|Session AI token limit|quota exceeded/i.test(
    String(text ?? ""),
  );
}

class QuotaExceededError extends Error {
  constructor(message = "账号今日 AI 配额已耗尽") {
    super(message);
    this.name = "QuotaExceededError";
  }
}

// ── 小工具 ────────────────────────────────────────────────────────────

function timestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function createLogger() {
  const started = Date.now();
  const stamp = () => {
    const seconds = ((Date.now() - started) / 1000).toFixed(1).padStart(7, " ");
    return `[e2e +${seconds}s]`;
  };
  return {
    log: (message) => console.log(`${stamp()} ${message}`),
    warn: (message) => console.warn(`${stamp()} WARN ${message}`),
    error: (message) => console.error(`${stamp()} ERROR ${message}`),
  };
}

function gitInfo() {
  const run = (args) =>
    execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  try {
    return {
      sha: run(["rev-parse", "--short", "HEAD"]),
      fullSha: run(["rev-parse", "HEAD"]),
      branch: run(["rev-parse", "--abbrev-ref", "HEAD"]),
    };
  } catch {
    return { sha: "unknown", fullSha: "unknown", branch: "unknown" };
  }
}

/**
 * 外部运行的四维归因元数据（跑一次就锁定，事后不再推断）。
 * - codeVersion：服务端 health 的 commitSha 优先（部署真值），其次
 *   `GIT_SHA`（CI 里没有 .git 也能记），最后本地 git sha
 * - gateMode：发布门禁当前模式（shadow 时数字与 enforce 不可直接对比）
 * - judgeSpecVersion：判官输入规范版本（Phase 2 起默认 v2，v1 仅回滚用）
 * - metricSpecVersion：指标定义版本（当前为 3）
 */
export function buildRunMetadata({
  env = process.env,
  git = gitInfo(),
  readEnv = readBackendEnv,
  serverCommitSha = null,
} = {}) {
  return {
    codeVersion:
      serverCommitSha || env.GIT_SHA || git.fullSha || git.sha || "unknown",
    gateMode: readEnv("AI_GROUNDING_GATE") || "shadow",
    judgeSpecVersion: readEnv("EVAL_JUDGE_SPEC") || "v2",
    metricSpecVersion: env.E2E_METRIC_SPEC_VERSION || HARNESS_METRIC_SPEC_VERSION,
  };
}

/** 报告落盘前统一脱敏：凭据类字段直接剔除，手机号打码。 */
const SECRET_KEYS = new Set([
  "confirmtoken",
  "token",
  "accesstoken",
  "refreshtoken",
  "otp",
  "otpcode",
  "csrf",
  "authorization",
  "password",
  "secret",
]);

const PHONE_PATTERN = /(\+63\d{9,10}|\b09\d{9}\b)/g;

export function maskPhonesInText(text) {
  return String(text).replace(PHONE_PATTERN, (match) => maskPhone(match));
}

export function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEYS.has(key.toLowerCase())) continue;
      out[key] = sanitize(item);
    }
    return out;
  }
  if (typeof value === "string") return maskPhonesInText(value);
  return value;
}

function caseFileName(config, id) {
  return path.join(
    config.runtimeDir,
    CASE_DIR_NAME,
    `${id.replace(/[^a-zA-Z0-9._-]+/g, "_")}.json`,
  );
}

function saveCaseResult(config, result) {
  const file = caseFileName(config, result.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(sanitize(result), null, 2)}\n`, {
    mode: 0o600,
  });
}

function loadCaseResults(config) {
  const dir = path.join(config.runtimeDir, CASE_DIR_NAME);
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      results.push(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
    } catch {
      // 半截文件（中断写入）直接忽略，重新跑该例
    }
  }
  return results;
}

// ── 账号池 ────────────────────────────────────────────────────────────

/**
 * 每账号一个 ClientSession（一个 socket），用例间互斥复用。
 * 优先轮转到下一个账号，避免单账号被连续打满日配额。
 */
/**
 * 从账号池里挑一个可用账号（纯函数，单测覆盖）。
 *
 * `reserved` 的账号留给动作/读类/边界用例——这些用例必须跑在「有地址、有
 * 余额、KYC 已过」的 fixture 账号上，一旦被知识题先把日配额烧完，整类用例
 * 就只能跳过。普通知识题只挑非保留账号；全部非保留账号都耗尽时才借用保留
 * 账号（宁可跑完，也不因为分池而死等）。
 */
export function pickPoolEntry(entries, cursor, { allowReserved = false } = {}) {
  const alive = entries.filter((entry) => !entry.exhausted);
  if (alive.length === 0) return null;
  const unpreferred = allowReserved ? alive : alive.filter((entry) => !entry.reserved);
  const usable = unpreferred.length > 0 ? unpreferred : alive;
  const start = cursor % entries.length;
  const rotated = usable.find((entry) => entry.index === start) ?? usable[0];
  const free = rotated && !rotated.busy ? rotated : usable.find((entry) => !entry.busy);
  return free ?? null;
}

function createAccountPool({
  accounts,
  config,
  transport,
  logger,
  onAccountsChange,
  reservedIndexes = [],
}) {
  const reserved = new Set(reservedIndexes);
  const entries = accounts.map((account, index) => ({
    index,
    account,
    busy: false,
    exhausted: false,
    reserved: reserved.has(index),
    primed: false,
    session: null,
  }));
  const waiters = [];
  let cursor = 0;

  function sessionFor(entry) {
    if (!entry.session) {
      entry.session = createClientSession(config, entry.account, {
        transport,
        logger,
        onTokenRefresh: (updated) => {
          if (updated) entry.account = updated;
          onAccountsChange?.(entries.map((item) => item.account));
        },
      });
    }
    return entry.session;
  }

  async function acquire({ userId = null, allowReserved = false } = {}) {
    if (userId) {
      const target = entries.find((entry) => entry.account.userId === userId);
      if (!target) throw new Error(`账号池里没有 userId=${userId} 的账号`);
      if (target.exhausted) throw new QuotaExceededError();
      while (target.busy) await new Promise((resolve) => waiters.push(resolve));
      target.busy = true;
      return target;
    }
    while (true) {
      const chosen = pickPoolEntry(entries, cursor, { allowReserved });
      if (!chosen) {
        const alive = entries.some((entry) => !entry.exhausted);
        throw new QuotaExceededError(
          alive ? "可用账号都在忙" : "所有账号今日 AI 配额已耗尽",
        );
      }
      if (!chosen.busy) {
        cursor = chosen.index + 1;
        chosen.busy = true;
        return chosen;
      }
      await new Promise((resolve) => waiters.push(resolve));
    }
  }

  /** 某账号今日 token 配额耗尽：之后不再分配给任何用例。 */
  function markExhausted(entry) {
    if (entry) entry.exhausted = true;
  }

  function release(entry) {
    entry.busy = false;
    for (const wake of waiters.splice(0)) wake();
  }

  return { entries, acquire, release, markExhausted, sessionFor };
}

// ── 轮次记录 ──────────────────────────────────────────────────────────

/** 把一次 send 的结果压成可落盘、可判定的形状（不含 confirmToken）。 */
function toRound(raw, rescued) {
  const reply = raw.reply;
  return {
    question: raw.question,
    outcome: raw.outcome,
    latencyMs: raw.latencyMs,
    repliedAt: raw.repliedAt,
    rescued: Boolean(rescued),
    socketDropped: Boolean(raw.socketDropped),
    errorMessage: raw.errorMessage ?? null,
    reply: reply
      ? {
          messageId: reply.messageId,
          content: reply.content,
          metaKind: reply.metaKind,
          sources: reply.sources,
        }
      : null,
    confirm: raw.confirm
      ? {
          action: raw.confirm.action ?? null,
          title: raw.confirm.title ?? null,
          summary: raw.confirm.summary ?? null,
          fields: raw.confirm.fields ?? null,
          needsOtp: Boolean(raw.confirm.needsOtp),
          expiresAt: raw.confirm.expiresAt ?? null,
          requestId: raw.confirm.requestId ?? null,
        }
      : null,
    transfer: raw.transfer
      ? { reason: raw.transfer.reason ?? raw.transfer.content ?? null }
      : null,
    events: (raw.events ?? []).map((event) => ({
      type: event.type,
      ...(event.type === "action_result_event" || event.type === "action_result"
        ? { data: event.data }
        : {}),
    })),
  };
}

/**
 * 发一轮；超时就 admin 把会话切回 AI 模式再重发一次。
 *
 * 「会话被人工认领 → AI 静默不回」是真实风险，这里显式记录 rescued，
 * 不把重发后的成功悄悄算成第一次就成功。
 */
async function sendTurn(runtime, session, question) {
  let raw = await session.send(question);
  let rescued = false;
  if (raw.outcome === "timeout" || raw.outcome === "disconnected") {
    // 断线时 session.send 会先重连再发；重发不隐藏，轮次里标 rescued。
    rescued = true;
    if (raw.outcome === "timeout") {
      await runtime.admin.setAiMode(session.conversationId).catch((error) => {
        runtime.logger.warn(
          `setAiMode 失败（${error?.message ?? error}）；仍重发一次`,
        );
      });
    }
    raw = await session.send(question);
    raw.firstTimedOut = true;
  }
  if (raw.outcome === "reply" && isQuotaReply(raw.reply?.content)) {
    throw new QuotaExceededError();
  }
  return { raw, round: toRound(raw, rescued) };
}

// ── 用例执行 ──────────────────────────────────────────────────────────

function baseResult(testCase) {
  return {
    id: testCase.id,
    kind: testCase.kind,
    action: testCase.action ?? null,
    assert: testCase.assert ?? null,
    expect: testCase.expect ?? null,
    lang: testCase.lang ?? null,
    domain: testCase.domain ?? null,
    sourceType: testCase.sourceType ?? null,
    manualQuestion: Boolean(testCase.manualQuestion),
    status: "ok",
    startedAt: new Date().toISOString(),
    rounds: [],
    judge: null,
    skipReason: null,
    errorMessage: null,
  };
}

async function openFreshConversation(runtime, entry) {
  const session = runtime.pool.sessionFor(entry);
  if (!entry.primed) {
    // 上一次运行可能留下未关的会话（带着历史），先关掉再建新的
    await session.openConversation();
    await runtime.admin
      .closeConversation(session.conversationId)
      .catch((error) =>
        runtime.logger.warn(
          `首次清理旧会话失败（${error?.message ?? error}）`,
        ),
      );
    entry.primed = true;
  }
  await session.openConversation();
  return session;
}

async function closeQuietly(runtime, session) {
  const id = session.conversationId;
  if (!id) return;
  try {
    await runtime.admin.closeConversation(id);
  } catch (error) {
    runtime.logger.warn(
      `关单失败 ${id}（${error?.message ?? error}）；下一个用例可能复用旧会话`,
    );
  }
}

async function runTurns(runtime, session, turns) {
  const rounds = [];
  for (const turn of turns) {
    const { round } = await sendTurn(runtime, session, turn);
    rounds.push(round);
  }
  return rounds;
}

async function runKnowledgeCase(runtime, testCase, session) {
  const result = baseResult(testCase);
  result.expectedDocIds = testCase.expectedDocIds ?? [];
  const rounds = await runTurns(runtime, session, testCase.turns);
  result.rounds = rounds;
  result.judge = await judgeKnowledgeCase({
    admin: runtime.admin,
    testCase,
    rounds,
    judgeConcurrency: runtime.config.judgeConcurrency,
  });
  return result;
}

async function runMultiCase(runtime, testCase, session) {
  const result = baseResult(testCase);
  result.expectedDocIds = testCase.expectedDocIds ?? [];
  const rounds = await runTurns(runtime, session, testCase.turns);
  result.rounds = rounds;
  const first = rounds[0]?.reply?.content ?? "";
  const second = rounds[1]?.reply?.content ?? "";
  result.repeatSimilarity = first && second ? similarity(first, second) : null;
  result.judge = await judgeKnowledgeCase({
    admin: runtime.admin,
    testCase,
    rounds,
    judgeConcurrency: runtime.config.judgeConcurrency,
  });
  return result;
}

async function runReadCase(runtime, testCase, session) {
  const result = baseResult(testCase);
  const rounds = await runTurns(runtime, session, testCase.turns);
  result.rounds = rounds;
  result.judge = await judgeReadCase({
    admin: runtime.admin,
    testCase,
    rounds,
  });
  return result;
}

async function runBoundaryCase(runtime, testCase, session) {
  const result = baseResult(testCase);
  const rounds = await runTurns(runtime, session, testCase.turns);
  result.rounds = rounds;
  result.judge = judgeBoundaryCase({ testCase, rounds });
  return result;
}

async function runActionCase(runtime, testCase, session) {
  const result = baseResult(testCase);
  const rounds = [];
  const fixture = runtime.fixtureSets?.[testCase.fixtureIndex ?? 0] ?? null;
  let rawConfirm = null;

  for (const turn of testCase.turns ?? []) {
    const { raw, round } = await sendTurn(runtime, session, turn);
    rounds.push(round);
    if (raw.outcome === "confirm") {
      rawConfirm = raw.confirm;
      break;
    }
  }

  // AI 按表单流追问（地址增改就是这种工具）时，用户要真的逐条回答；
  // 最多 6 轮，答完仍没卡就退回到「确认」同意轮。
  const answerNext = createAnswerDriver({
    action: testCase.action,
    slots: fixture?.slots ?? {},
    label: testCase.verify?.label,
  });
  for (let step = 0; !rawConfirm && step < 6; step += 1) {
    const replyText = rounds[rounds.length - 1]?.reply?.content ?? "";
    const answer = answerNext(replyText);
    if (!answer) break;
    const { raw, round } = await sendTurn(runtime, session, answer);
    round.followUp = true;
    rounds.push(round);
    if (raw.outcome === "confirm") rawConfirm = raw.confirm;
  }

  // 场景问句没让模型发卡时，允许一次「确认」同意轮（补同意，不改题）
  if (!rawConfirm && testCase.expectConfirm) {
    const { raw, round } = await sendTurn(
      runtime,
      session,
      confirmReplyFor(testCase.action),
    );
    round.consentTurn = true;
    rounds.push(round);
    if (raw.outcome === "confirm") rawConfirm = raw.confirm;
  }

  result.rounds = rounds;

  // 写操作样本一律不执行（eval-run-integrity D8）：
  // 拿到确认卡片就停，不调 session.confirm，也不做执行后的读接口核验。
  // 通过与否只看卡片字段；需要真实执行验收时另立隔离环境 change。
  result.confirmOutcome = null;
  result.confirmError = null;
  result.judge = await judgeActionCase({
    admin: runtime.admin,
    testCase,
    rounds,
  });
  return result;
}

const KIND_RUNNERS = {
  knowledge: runKnowledgeCase,
  negative: runKnowledgeCase,
  multi: runMultiCase,
  read: runReadCase,
  boundary: runBoundaryCase,
  action: runActionCase,
};

async function runOne(runtime, testCase, entry) {
  const startedAt = Date.now();
  const session = await openFreshConversation(runtime, entry);
  const result = baseResult(testCase);
  // 记下会话 id：后续可用 admin API（?conversationId=）复查，不必依赖 DB
  result.conversationId = session.conversationId ?? null;
  try {
    const runner = KIND_RUNNERS[testCase.kind];
    if (!runner) throw new Error(`未知用例类型 ${testCase.kind}`);
    const value = await runner(runtime, testCase, session);
    Object.assign(result, value, {
      status: "ok",
      startedAt: result.startedAt,
      elapsedMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      // 配额耗尽不是答案质量失败：显式跳过，并把该账号从池里摘掉。
      runtime.pool.markExhausted(entry);
      result.status = "skipped";
      result.skipReason = error.message;
      result.elapsedMs = Date.now() - startedAt;
      runtime.logger.warn(`${testCase.id} 跳过：${error.message}`);
      return result;
    }
    result.status = "error";
    result.errorMessage = error?.message ?? String(error);
    result.elapsedMs = Date.now() - startedAt;
    runtime.logger.warn(`${testCase.id} 执行失败：${result.errorMessage}`);
    return result;
  } finally {
    await closeQuietly(runtime, session);
  }
}

// ── 用例清单 ──────────────────────────────────────────────────────────

function skippedResult(testCase, reason) {
  return {
    ...baseResult(testCase),
    status: "skipped",
    skipReason: reason,
    rounds: [],
  };
}

function isSkippedByConfig(config, testCase) {
  const keys = [testCase.id, testCase.id.split(":")[1], testCase.kind];
  return keys.some((key) => key && config.skip.has(String(key).toLowerCase()));
}

function blockedReason(fixtures, prepareKey) {
  const blocker = (fixtures?.blockers ?? []).find((item) => item.step === prepareKey);
  return blocker?.reason ?? `前置步骤 ${prepareKey} 未就绪`;
}

/**
 * 前置数据分散在多个账号时，把用例轮流分给它们：每个用例只跑一次，
 * 但用「它将要落到的那个账号」的槽位渲染问句（订单号、券码都是账号相关的）。
 */
function assignCases(build, sets) {
  const rendered = sets.map((set, index) =>
    build(set.slots ?? {}).map((item) => ({ ...item, fixtureIndex: index })),
  );
  const max = Math.max(...rendered.map((list) => list.length));
  const out = [];
  for (let index = 0; index < max; index += 1) {
    const candidate = rendered[index % rendered.length]?.[index];
    if (candidate) out.push(candidate);
  }
  return out;
}

function buildCases(config, fixtureSets = []) {
  const allGoldens = loadGoldens();
  const withDocs = allGoldens.filter((item) => item.expectedDocIds.length > 0);
  const sets = fixtureSets.length > 0 ? fixtureSets : [{ slots: {} }];

  const knowledge = buildKnowledgeCases(allGoldens, {
    limit: config.knowledgeLimit,
  });
  const multi = pairMultiTurn(withDocs, {
    maxPairs: config.multiLimit > 0 ? config.multiLimit : MULTI_PAIR_DEFAULT,
  });

  let actions = assignCases(buildActionCases, sets);
  if (config.actions) {
    const wanted = new Set(config.actions.map((item) => item.toLowerCase()));
    actions = actions.filter(
      (item) =>
        wanted.has(item.action.toLowerCase()) ||
        wanted.has(item.id.split(":")[1]?.toLowerCase() ?? ""),
    );
  }

  const reads = assignCases(buildReadCases, sets);
  const boundaries = assignCases(buildBoundaryCases, sets);

  const wantedKinds = config.kinds ? new Set(config.kinds) : null;
  const keepKinds = (item) => {
    if (!wantedKinds) return true;
    if (item.kind === "negative") return wantedKinds.has("knowledge") || wantedKinds.has("negative");
    return wantedKinds.has(item.kind);
  };

  const built = [
    ...knowledge,
    ...multi,
    ...actions,
    ...reads,
    ...boundaries,
  ].filter(keepKinds);
  // 子集：caseId 集合来自上次全量运行的 datasetSnapshot.cases；
  // buildCases 只负责把当前能装配的用例收窄到这些 id。
  if (config.scope === "subset") {
    const selected = filterCasesToSubset(built, config.subsetCaseIds ?? []);
    config.subsetExcluded = built.length - selected.length;
    return selected;
  }
  config.subsetExcluded = 0;
  return built;
}

// ── 主流程 ────────────────────────────────────────────────────────────

export async function main(env = process.env) {
  const logger = createLogger();
  const config = loadConfig(env);
  // 提现二段的 OTP 与建号共用同一个 dev 固定码
  config.otpCode = resolveOtpCode(config, { env, logger });

  const stats = { requests: 0, throttled: 0, retries: 0 };
  const transport = createHttpTransport(config, { stats });
  // 客户端、admin、judge 共用同一个节流器与同一份计数：
  // 后端的全局限流是 60 次/分/IP，三类请求一起算。
  const admin = createAdminApi(config, {
    logger,
    throttle: transport.throttle,
    stats,
  });

  const runtime = { config, logger, transport, admin, stats, pool: null, fixtureSets: [] };

  logger.log(`目标：${config.apiBaseUrl}（${config.businessId} / ${config.trafficSource}）`);

  const fingerprintParts = [];
  for (const relative of GOLDEN_FILES) {
    fingerprintParts.push(fs.readFileSync(path.join(REPO_ROOT, relative), "utf8"));
  }

  const health = await runtime.transport.request("/v1/health");
  const healthy = health?.ok === true || health?.status === "ok";
  const serverCommitSha = readServerCommitSha(health);
  logger.log(
    `后端健康：${healthy ? "ok" : JSON.stringify(health)}` +
      (serverCommitSha ? `（commit ${serverCommitSha.slice(0, 8)}）` : ""),
  );
  if (!healthy) {
    throw new Error(`后端健康检查未通过（health=${JSON.stringify(health)}）`);
  }

  const adminSource = await admin.whoami();
  logger.log(`管理员令牌来源：${adminSource}`);

  // ── 子集映射：只信上次全量运行的用例快照，不解析 golden ──
  if (config.scope === "subset") {
    let baseRun = null;
    if (config.baseRunId) {
      try {
        baseRun = await admin.getEvalRun(config.baseRunId);
      } catch (error) {
        throw new Error(
          `需先跑一次全量：读取 E2E_BASE_RUN_ID=${config.baseRunId} 失败（${error?.message ?? error}）`,
        );
      }
    }
    const selection = selectSubsetFromFullRun(baseRun, config.docIds, {
      includeNegatives: config.includeNegatives,
    });
    if (selection.error) throw new Error(selection.error);
    config.subsetCaseIds = selection.caseIds;
    logger.log(
      `子集映射：全量快照 ${baseRun.datasetSnapshot.cases.length} 条 → ` +
        `受影响 ${selection.caseIds.length} 条（文档 ${config.docIds.join(", ")}）`,
    );
  }

  const allGoldens = loadGoldens();
  const positives = allGoldens.filter((item) => item.expectedDocIds.length > 0);
  logger.log(
    `题库：${allGoldens.length} 条（正样本 ${positives.length} / 负样本 ${allGoldens.length - positives.length}）`,
  );
  if (allGoldens.length === 0) throw new Error("题库为空");

  const smoke = await admin.judgeFaithfulness({
    question: "How long does a refund take?",
    answer: "Refunds are processed within 7 business days.",
    sources: [
      {
        title: "refund-policy",
        content: "Refunds are processed within 7 business days after approval.",
      },
    ],
  });
  if (!smoke || typeof smoke.faithful !== "boolean") {
    throw new Error("RAG judge 冒烟未返回 faithful 字段，判定链路不可用");
  }
  logger.log(`judge 冒烟通过（faithful=${smoke.faithful}）`);

  // ── 账号 ──
  logger.log(`准备 ${config.accountCount} 个真实账号…`);
  const { accounts, created, reused } = await ensureAccounts(config, { logger });
  logger.log(
    `账号池就绪：${maskPhone(accounts[0]?.phone)} 等 ${accounts.length} 个` +
      `（新建 ${created}，复用 ${reused}）`,
  );

  // ── 前置数据（产品接口） ──
  //
  // 动作/读类/边界用例依赖账号里的真实数据（地址、KYC、余额、抽奖券、订单），
  // 这些数据必须建在用例实际使用的账号上。全压在一个账号会撞「每用户每天
  // 20 万 token」的 AI 配额，所以按 E2E_FIXTURE_ACCOUNTS 分散到多个账号，
  // 用例在这些账号之间轮转。
  const needsFixtures = !config.kinds || config.kinds.some((kind) =>
    ["action", "read", "boundary"].includes(kind),
  );
  const fixtureOffset = needsFixtures
    ? Math.min(config.fixtureAccountOffset, Math.max(accounts.length - 1, 0))
    : 0;
  const fixtureCount = needsFixtures
    ? Math.min(config.fixtureAccounts, accounts.length - fixtureOffset)
    : 0;
  const fixtureIndexes = Array.from(
    { length: fixtureCount },
    (_, index) => fixtureOffset + index,
  );

  runtime.pool = createAccountPool({
    accounts,
    config,
    transport,
    logger,
    reservedIndexes: fixtureIndexes,
    onAccountsChange: (list) => saveAccounts(config.runtimeDir, list),
  });

  const fixtureSets = [];
  if (needsFixtures) {
    logger.log(
      `准备业务前置数据（${fixtureCount} 个账号 #${fixtureOffset + 1}` +
        `–#${fixtureOffset + fixtureCount}：admin 券/KYC/余额 + 客户端下单/地址）…`,
    );
    for (const entry of runtime.pool.entries.slice(
      fixtureOffset,
      fixtureOffset + fixtureCount,
    )) {
      const session = runtime.pool.sessionFor(entry);
      // eslint-disable-next-line no-await-in-loop
      const set = await prepareFixtures({ admin, client: session, logger });
      fixtureSets.push(set);
    }
  }
  runtime.fixtureSets = fixtureSets;

  // ── 用例清单 ──
  const allCases = buildCases(config, fixtureSets).map((testCase) => {
    const fixture = fixtureSets[testCase.fixtureIndex ?? 0] ?? null;
    const pinned =
      fixture && ["action", "read", "boundary"].includes(testCase.kind)
        ? { ...testCase, pinUserId: fixture.userId }
        : testCase;
    if (pinned.skipReason) {
      return { ...pinned, presetSkip: pinned.skipReason };
    }
    if (pinned.prepareKey && pinned.prepareKey !== "none") {
      if (fixture?.ready?.[pinned.prepareKey] === false) {
        return { ...pinned, presetSkip: blockedReason(fixture, pinned.prepareKey) };
      }
    }
    if (isSkippedByConfig(config, pinned)) {
      return { ...pinned, presetSkip: "E2E_SKIP" };
    }
    return pinned;
  });

  if (config.scope === "subset") {
    logger.log(
      `子集执行：选中 ${allCases.length} 条，过滤 ${config.subsetExcluded ?? 0} 条` +
        `（映射 ${config.subsetCaseIds?.length ?? 0} 条，未装配 ${Math.max(
          (config.subsetCaseIds?.length ?? 0) - allCases.length,
          0,
        )} 条）`,
    );
  }

  const existing = config.resume ? loadCaseResults(config) : [];
  if (!config.resume) {
    const dir = path.join(config.runtimeDir, CASE_DIR_NAME);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const done = new Map(existing.map((item) => [item.id, item]));

  const results = new Map();
  const queue = [];
  for (const testCase of allCases) {
    if (done.has(testCase.id)) {
      results.set(testCase.id, done.get(testCase.id));
      continue;
    }
    if (testCase.presetSkip) {
      const skipped = skippedResult(testCase, testCase.presetSkip);
      results.set(testCase.id, skipped);
      saveCaseResult(config, skipped);
      continue;
    }
    queue.push(testCase);
  }

  if (done.size > 0) logger.log(`断点续跑：复用 ${done.size} 个已完成用例`);
  logger.log(`待执行：${queue.length} 个用例，并发 ${config.concurrency}`);

  // ── 外部运行记录（EXTERNAL）──
  //
  // 双写：JSON 报告仍是主产物，这一份只是把本轮结果登记到 ai_eval_runs，
  // 让「和哪轮比、口径变没变」有据可查。任何写库失败都只告警，不阻断验收。
  const syncCases = allCases.filter((item) => !item.presetSkip);
  const snapshot = buildExternalSnapshot(syncCases, {
    fingerprint,
    goldenParts: fingerprintParts,
  });
  const snapshotIds = new Set(snapshot.cases.map((item) => item.caseId));
  const runMetadata = buildRunMetadata({ env, serverCommitSha });
  const externalSyncEnabled = env.E2E_DISABLE_EXTERNAL_SYNC !== "1";
  // 开跑前读一次语料指纹；读不到就上送空，服务端会按缺失标 stable=false。
  let knowledgeFingerprintBefore = null;
  if (externalSyncEnabled) {
    try {
      const corpus = await admin.getCorpusFingerprint();
      knowledgeFingerprintBefore = corpus?.fingerprint ?? null;
      logger.log(
        `语料指纹（开跑前）：${knowledgeFingerprintBefore ?? "缺失"}`,
      );
    } catch (error) {
      logger.warn(
        `语料指纹读取失败（开跑前，证据将记 stable=false）：${error?.message ?? error}`,
      );
    }
  }
  let externalRunId = null;
  if (!externalSyncEnabled) {
    logger.log("E2E_DISABLE_EXTERNAL_SYNC=1：跳过外部评测运行写入");
  } else if (syncCases.length === 0) {
    logger.warn("没有可登记的用例，跳过外部评测运行");
  } else {
    try {
      const run = await admin.createExternalEvalRun({
        datasetFingerprint: snapshot.datasetFingerprint,
        cases: snapshot.cases,
        ...runMetadata,
        ...buildKnowledgeCreateFields({
          scope: config.scope,
          fingerprintBefore: knowledgeFingerprintBefore,
        }),
      });
      externalRunId = run?.id ?? null;
      logger.log(
        `外部评测运行：${externalRunId}（代码 ${runMetadata.codeVersion.slice(0, 8)}，` +
          `门禁 ${runMetadata.gateMode}，判官 ${runMetadata.judgeSpecVersion}，` +
          `指标 ${runMetadata.metricSpecVersion}）`,
      );
    } catch (error) {
      logger.warn(
        `外部评测运行创建失败（JSON 报告仍会生成）：${error?.message ?? error}`,
      );
    }
  }
  const blockers = fixtureSets.flatMap((set) => set.blockers ?? []);
  if (blockers.length) {
    logger.warn(`${blockers.length} 个前置步骤未就绪，相关用例会显式跳过`);
  }

  // ── 执行 ──
  const total = queue.length;
  let completed = 0;
  const startedAt = new Date();

  async function worker() {
    while (queue.length > 0) {
      const testCase = queue.shift();
      let entry = null;
      let result;
      try {
        entry = await runtime.pool.acquire(
          testCase.pinUserId ? { userId: testCase.pinUserId } : undefined,
        );
        result = await runOne(runtime, testCase, entry);
      } catch (error) {
        result = {
          ...baseResult(testCase),
          status: error instanceof QuotaExceededError ? "skipped" : "error",
          skipReason:
            error instanceof QuotaExceededError ? error.message : null,
          errorMessage:
            error instanceof QuotaExceededError ? null : error?.message ?? String(error),
        };
      } finally {
        if (entry) runtime.pool.release(entry);
      }
      results.set(result.id, result);
      saveCaseResult(config, result);
      completed += 1;
      const badge =
        result.status === "ok"
          ? result.judge?.pass === false
            ? "✗"
            : "✓"
          : result.status === "error"
            ? "!"
            : "·";
      logger.log(`[${completed}/${total}] ${badge} ${result.id}`);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(config.concurrency, Math.max(queue.length, 1)) }, () =>
      worker(),
    ),
  );

  // ── 清理 ──
  for (const entry of runtime.pool.entries) {
    if (!entry.session) continue;
    await closeQuietly(runtime, entry.session);
    entry.session.close();
  }

  // ── 报告 ──
  let cases = allCases.map((testCase) => results.get(testCase.id)).filter(Boolean);

  // 依据来源：一次只读查询补齐（兜底 / 工具 / 知识库 / 无依据分组）
  try {
    const grounding = loadGrounding({ messageIds: collectMessageIds(cases) });
    cases = applyGrounding(cases, grounding);
    // 实时判定时按「回答有没有引用」推断可能是 none，traces 显示其实检索到了 → 补判 B
    const missing = cases.filter(
      (item) =>
        item.status === "ok" &&
        item.judge?.grounding?.kind === "kb" &&
        item.judge?.goldenAgreement?.applicable === true &&
        item.judge.goldenAgreement.faithful == null &&
        (item.expectedDocIds ?? []).length > 0,
    );
    for (const item of missing) {
      const last = item.rounds?.[item.rounds.length - 1];
      item.judge.goldenAgreement = await judgeGoldenAgreement({
        admin: runtime.admin,
        question: last?.question ?? item.question ?? "",
        answer: last?.reply?.content ?? "",
        expectedDocIds: item.expectedDocIds,
        citedDocIds: citedDocIdsFor(
          item.expectedDocIds,
          last?.reply?.sources ?? [],
        ),
      });
    }
    if (missing.length > 0) {
      logger.log(`依据来源补判：${missing.length} 条（实时判定时未识别为知识库依据）`);
    }
  } catch (error) {
    logger.warn(
      `依据来源关联失败（报告仍会生成，旧口径不受影响）：${error?.message ?? error}`,
    );
  }

  // ── 外部运行收尾：写结果并置 COMPLETED / FAILED ──
  let externalRun = externalRunId
    ? { id: externalRunId, status: "running" }
    : {
        id: null,
        status: externalSyncEnabled ? "unavailable" : "disabled",
      };
  // 收尾前再读一次：与开跑前相同才说明本轮语料稳定，可作为发布证据。
  let knowledgeFingerprintAfter = null;
  if (externalRunId) {
    try {
      const corpus = await admin.getCorpusFingerprint();
      knowledgeFingerprintAfter = corpus?.fingerprint ?? null;
      logger.log(
        `语料指纹（收尾前）：${knowledgeFingerprintAfter ?? "缺失"}` +
          (knowledgeFingerprintBefore &&
          knowledgeFingerprintAfter &&
          knowledgeFingerprintBefore !== knowledgeFingerprintAfter
            ? "（本轮语料发生变化，证据不可用）"
            : ""),
      );
    } catch (error) {
      logger.warn(
        `语料指纹读取失败（收尾前，证据将记 stable=false）：${error?.message ?? error}`,
      );
    }
  }
  if (externalRunId) {
    try {
      const payload = cases
        .filter((item) => snapshotIds.has(item.id))
        .map(toExternalResult);
      await admin.ingestExternalEvalResults(externalRunId, {
        cases: payload,
        status: "COMPLETED",
        ...buildKnowledgeIngestFields({
          fingerprintBefore: knowledgeFingerprintBefore,
          fingerprintAfter: knowledgeFingerprintAfter,
        }),
      });
      externalRun.status = "completed";
      logger.log(`外部评测结果已写入：${externalRunId}（${payload.length} 条）`);

      // 读回库内 summary：报告的「运行记录与基线」段与本地复核都以它为准。
      try {
        const record = await admin.getEvalRun(externalRunId);
        const summary = record?.summary ?? null;
        externalRun.baselineRunId = record?.baselineRunId ?? null;
        externalRun.isBaseline = Boolean(record?.isBaseline);
        externalRun.summary = summary;
        externalRun.consistency = compareSummaryWithRecord(
          summarizeExternalResults(payload, {
            scope: config.scope,
            selectedCaseCount: snapshot.cases.length,
          }),
          summary,
        );
        if (!externalRun.consistency.ok) {
          logger.warn(
            `库内 summary 与本地复核不一致：${externalRun.consistency.mismatches
              .map((item) => item.field)
              .join(", ")}`,
          );
        }
      } catch (recordError) {
        logger.warn(
          `运行记录读回失败（报告缺少库内对比段）：${recordError?.message ?? recordError}`,
        );
      }
    } catch (error) {
      externalRun.status = "failed";
      externalRun.error = error?.message ?? String(error);
      logger.warn(
        `外部评测结果写入失败（JSON 报告仍然保留）：${externalRun.error}`,
      );
      await admin
        .failExternalEvalRun(externalRunId, externalRun.error)
        .catch(() => undefined);
    }
  }

  const git = gitInfo();
  const llmType = readBackendEnv("AI_LLM_TYPE") ?? "online";
  const chatModel =
    process.env.E2E_CHAT_MODEL ||
    readBackendEnv("OLLAMA_MODEL") ||
    (llmType === "local" ? "qwen3.5:0.8b" : "deepseek-chat");
  const judgeModel =
    cases.find((item) => item.judge?.taskJudge?.judgeModel)?.judge.taskJudge
      .judgeModel ?? null;

  const meta = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    apiBaseUrl: config.apiBaseUrl,
    businessId: config.businessId,
    trafficSource: config.trafficSource,
    gitSha: git.sha,
    branch: git.branch,
    accountCount: accounts.length,
    concurrency: config.concurrency,
    // 指纹必须覆盖「本次登记的用例集」，否则同一 golden 文件下按 kind 过滤运行
    // 会撞上上次物化的数据集，行数校验直接失败。
    datasetFingerprint: snapshot.datasetFingerprint,
    ...runMetadata,
    externalRun,
    chatModel,
    judgeModel,
    resume: config.resume,
  };

  const outDir = path.join(config.reportsDir, timestamp(startedAt));
  writeReport(
    {
      meta,
      fixtures: {
        log: fixtureSets.flatMap((set) => set.log ?? []),
        blockers,
        ready: Object.assign({}, ...fixtureSets.map((set) => set.ready ?? {})),
      },
      stats: { ...stats },
      cases,
    },
    outDir,
  );
  logger.log(`报告已写入 ${path.relative(process.cwd(), outDir)}/summary.md`);
  const ok = cases.filter((item) => item.status === "ok").length;
  const skipped = cases.filter((item) => item.status === "skipped").length;
  const errored = cases.filter((item) => item.status === "error").length;
  logger.log(`完成：${ok} 个用例正常结束，${skipped} 跳过，${errored} 异常`);
  return { outDir, meta, cases };
}

// 直接执行（被 import 时不跑）
const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[e2e] 运行失败：${error?.stack ?? error}`);
    process.exitCode = 1;
  });
}
