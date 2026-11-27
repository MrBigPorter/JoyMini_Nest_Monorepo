/**
 * 外部运行（EXTERNAL）的记录映射：把 harness 的用例与判定结果，
 * 转成 `POST /admin/ai-eval/runs/external` 接口要的形状。
 *
 * Phase 1 的原则是「只接线，不改判定」：
 *   - 每条判定都来自 harness 现有 judge，不在这里重新解释；
 *   - 任务完成度（action/read/boundary）与答案准确性不是一回事，
 *     记 `judge_error + not_applicable`，不并进准确率分母；
 *   - harness 自己跑挂的用例记 `judge_error + harness`，同样不进分母。
 *
 * Phase 2 的指标规范会重新定义分母与 `judgeErrorRate` 的排除项；
 * 在那之前，reason 字段保留原始判定文本，便于回查。
 */

import { JUDGE_FAILURE_KINDS, METRIC_SPEC_VERSION } from "./metrics-spec.mjs";

/** 外部运行写入的指标定义版本；与报告/服务端共用同一个版本号。 */
export const HARNESS_METRIC_SPEC_VERSION = String(METRIC_SPEC_VERSION);

const MAX_QUESTION_CHARS = 8000;

function lastRound(item) {
  const rounds = item?.rounds ?? [];
  return rounds[rounds.length - 1] ?? null;
}

function truncateQuestion(text) {
  const value = String(text ?? "");
  return value.length > MAX_QUESTION_CHARS
    ? value.slice(0, MAX_QUESTION_CHARS)
    : value;
}

/**
 * 判官失败原因 → 五类错误之一。
 *
 * 判定端点目前只返回自由文本 reason（Phase 2 才会返回结构化 errorKind），
 * 所以这里做一次保守归类；分不出来的落 output_format，避免拿错误分类
 * 去解释别的问题。
 */
export function classifyJudgeError(reason) {
  const text = String(reason ?? "").toLowerCase();
  if (/rate.?limit|429|too many requests|quota/.test(text)) return "rate_limit";
  if (/timeout|timed out|etimedout|aborted|abort/.test(text)) return "timeout";
  if (/auth|401|403|unauthori|forbidden|invalid token/.test(text)) return "auth";
  if (/policy|content.?filter|safety|blocked/.test(text)) return "policy";
  return "output_format";
}

function verdict(result, reason, answerScore) {
  return {
    ...result,
    answerVerdict: "correct",
    ...(answerScore !== undefined ? { answerScore } : {}),
    reason,
  };
}

function incorrect(result, reason, answerScore) {
  return {
    ...result,
    answerVerdict: "incorrect",
    answerScore: answerScore ?? 0,
    reason,
  };
}

function judgeError(result, kind, reason) {
  return {
    ...result,
    answerVerdict: "judge_error",
    judgeErrorKind: kind,
    reason,
  };
}

/** 本维度不判答案准确性（任务完成度 / 安全断言），只记录不并入分母。 */
function notApplicable(result, reason) {
  return {
    ...result,
    answerVerdict: "judge_error",
    judgeErrorKind: "not_applicable",
    reason: `not_applicable: ${reason}`,
  };
}

function reasonOf(judge) {
  return String(judge?.reason ?? "").trim();
}

/**
 * 判读一次答案判定的结果。
 *
 * 顺序固定，且必须穷尽：不适用 → 布尔结论 → 结构化失败类别 →
 * 兼容旧文本前缀 → 不适用。
 *
 * 最后一步不能退回 `output_format`：判官调过、却既没给结论也没给失败
 * 类别，说明没有失败证据；记成判官失败会把失败率推高（negative 空壳
 * 被记成 output_format 就是这么来的）。
 */
function answerVerdictOf(base, judged, labels) {
  if (judged.applicable === false) {
    return notApplicable(base, reasonOf(judged) || labels.notApplicable);
  }
  if (judged.faithful === true) {
    return verdict(base, reasonOf(judged) || labels.faithful, judged.score);
  }
  if (judged.faithful === false) {
    return incorrect(base, reasonOf(judged) || labels.unfaithful, judged.score);
  }
  // 结构化失败类别：只要在既有枚举内就直接采用，不再从文本猜。
  if (judged.errorKind === "not_applicable") {
    return notApplicable(base, reasonOf(judged) || labels.notApplicable);
  }
  if (JUDGE_FAILURE_KINDS.includes(judged.errorKind)) {
    return judgeError(
      base,
      judged.errorKind,
      reasonOf(judged) || labels.judgeError,
    );
  }
  // 旧数据只有自由文本 reason：只认明确的判官失败前缀。
  const reason = reasonOf(judged);
  if (/^judge_error\b/.test(reason)) {
    return judgeError(base, classifyJudgeError(reason), reason);
  }
  return notApplicable(base, labels.inconclusive);
}

/** 知识类（knowledge / negative / multi）的答案准确性判定。 */
function knowledgeVerdict(base, item) {
  const judge = item.judge ?? {};
  const golden = judge.goldenAgreement ?? null;

  if (golden) {
    return answerVerdictOf(base, golden, {
      notApplicable: "golden_not_applicable",
      faithful: "golden_faithful",
      unfaithful: "golden_unfaithful",
      judgeError: "golden_judge_error",
      inconclusive: "golden_judge_inconclusive",
    });
  }

  const faithfulness = judge.faithfulness ?? null;
  if (faithfulness) {
    return answerVerdictOf(base, faithfulness, {
      notApplicable: "judge_not_applicable",
      faithful: "faithful",
      unfaithful: "unfaithful",
      judgeError: "judge_error",
      inconclusive: "judge_inconclusive",
    });
  }

  // 没有跑到任何答案判定：兜底话术不是回答，无依据/工具类不进准确率分母。
  const why = judge.canned
    ? "canned_reply_not_an_answer"
    : judge.answered === false
      ? "no_answer"
      : "no_answer_judge_applied";
  return notApplicable(base, why);
}

/**
 * harness 用例结果 → 外部结果。
 *
 * 注意：`action` / `read` / `boundary` 的判定分别是任务完成度与安全断言，
 * 与「答案准确性」不是同一维度，Phase 1 一律 not_applicable；它们仍会写入
 * run（保持行数与用例数一致），只是不进准确率分母。
 */
/**
 * 判官重复采样的稳定性字段（metric spec v3）。
 * 只有 ≥2 次成功判定才带出去；旧数据没有这些字段，不进稳定性分母。
 */
function agreementOf(item) {
  const judge = item?.judge?.goldenAgreement;
  const successful = Number(judge?.judgeSuccessfulAttempts);
  if (!Number.isFinite(successful)) return {};
  const out = { judgeSuccessfulAttempts: successful };
  const agreement = Number(judge?.judgeAgreement);
  if (Number.isFinite(agreement)) out.judgeAgreement = agreement;
  if (judge?.judgeDisagreement === true) out.judgeDisagreement = true;
  return out;
}

/**
 * 逐次判官尝试 → 上送 DTO（服务端落 ai_eval_judge_attempts）。
 *
 * 原始输出在判官出口已截断并脱敏，harness 只做字段改名，不再加工内容。
 * 旧判官响应没有 judgeAttempts 时不上送，保持向后兼容。
 */
function attemptsOf(item) {
  const judge = item?.judge?.goldenAgreement;
  const attempts = judge?.judgeAttempts;
  if (!Array.isArray(attempts) || attempts.length === 0) return {};
  return {
    judgeAttempts: attempts.map((attempt, index) => ({
      attemptIndex: index,
      outcome:
        attempt?.faithful === true || attempt?.faithful === false
          ? "success"
          : attempt?.errorKind === "output_format"
            ? "parse_failed"
            : "call_error",
      ...(Number.isFinite(attempt?.score) ? { score: attempt.score } : {}),
      ...(attempt?.errorKind ? { errorKind: attempt.errorKind } : {}),
      ...(typeof attempt?.rawOutput === "string"
        ? { rawOutput: attempt.rawOutput }
        : {}),
      ...(typeof attempt?.rawTruncated === "boolean"
        ? { rawTruncated: attempt.rawTruncated }
        : {}),
      ...(judge?.judgeSpecVersion
        ? { judgeVersion: judge.judgeSpecVersion }
        : {}),
      ...(judge?.judgeInputHash
        ? { judgeInputHash: judge.judgeInputHash }
        : {}),
    })),
  };
}

export function toExternalResult(item) {
  const last = lastRound(item);
  const grounding =
    item?.judge?.grounding?.kind ?? item?.grounding?.kind ?? "unknown";
  const base = {
    caseId: item.id,
    grounding,
    ...attemptsOf(item),
    ...(Number.isFinite(last?.latencyMs)
      ? { latencyMs: Math.max(0, Math.round(last.latencyMs)) }
      : {}),
    ...agreementOf(item),
  };

  if (item.status === "skipped") {
    // harness 自己没跑完（含账号配额耗尽）不是判官失败；
    // rate_limit 只用于判官 API 真的返回 429 的情况。
    const reason = item.skipReason ?? "skipped";
    return judgeError(base, "harness", `harness_skipped: ${reason}`);
  }
  if (item.status === "error") {
    return judgeError(
      base,
      "harness",
      `harness_error: ${item.errorMessage ?? "unknown"}`,
    );
  }

  if (item.kind === "knowledge" || item.kind === "negative" || item.kind === "multi") {
    return knowledgeVerdict(base, item);
  }
  if (item.kind === "action") {
    return notApplicable(base, "task_completion_dimension");
  }
  if (item.kind === "read") {
    return notApplicable(base, "task_completion_dimension");
  }
  if (item.kind === "boundary") {
    return notApplicable(base, "security_assertion_dimension");
  }
  return notApplicable(base, `unknown_kind: ${item.kind ?? "none"}`);
}

/**
 * 本地复核：按与服务端相同的口径汇总已提交的 results。
 * 用于在报告里核对「库内 summary 与本地计算是否一致」。
 */
export function summarizeExternalResults(
  results,
  { scope = "full", selectedCaseCount = null } = {},
) {
  const counts = { correct: 0, incorrect: 0, judge_error: 0 };
  let attempted = 0;
  let failures = 0;
  const kinds = new Map();
  for (const item of results ?? []) {
    counts[item.answerVerdict] += 1;
    if (item.answerVerdict !== "judge_error") {
      attempted += 1;
      continue;
    }
    const kind = item.judgeErrorKind ?? "unknown";
    if (!JUDGE_FAILURE_KINDS.includes(kind)) continue;
    attempted += 1;
    failures += 1;
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  const judged = counts.correct + counts.incorrect;
  const total = results?.length ?? 0;
  // 判官稳定性：全票一致用例 / 有 ≥2 次成功判定的用例。
  const agreementRows = (results ?? []).filter(
    (item) => (item.judgeSuccessfulAttempts ?? 0) >= 2,
  );
  const unanimous = agreementRows.filter(
    (item) =>
      item.judgeDisagreement !== true && Number(item.judgeAgreement) === 1,
  ).length;
  const judgeDisagreement = agreementRows.filter(
    (item) => item.judgeDisagreement === true,
  ).length;
  return {
    total,
    correct: counts.correct,
    incorrect: counts.incorrect,
    judgeError: counts.judge_error,
    accuracy: judged > 0 ? round4(counts.correct / judged) : null,
    // 覆盖率只看「有没有得到布尔判定」：分母是本次入库条数（含跳过与不适用），
    // 零条时无定义，返回 null 而不是 0。
    judgedCases: judged,
    coverage: total > 0 ? round4(judged / total) : null,
    judgeErrorRate: attempted > 0 ? round4(failures / attempted) : null,
    judgeErrorKinds: [...kinds.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([kind, count]) => ({ kind, count })),
    judgeAgreement:
      agreementRows.length > 0
        ? round4(unanimous / agreementRows.length)
        : null,
    judgeAgreementMeasured: agreementRows.length,
    judgeDisagreement,
    // 子集与全量必须可区分：scope 落 summary，selectedCaseCount 记录本次
    // 登记到外部 run 的用例数（全量=数据集用例数）。
    scope,
    selectedCaseCount,
  };
}

/** 比对本地复核值与库内 summary；字段值取服务端同样的小数位。 */
export function compareSummaryWithRecord(local, record) {
  const fields = [
    "total",
    "correct",
    "incorrect",
    "judgeError",
    "accuracy",
    "judgedCases",
    "coverage",
    "judgeErrorRate",
    "judgeAgreement",
    "judgeAgreementMeasured",
    "judgeDisagreement",
    "scope",
    "selectedCaseCount",
  ];
  const mismatches = fields
    .filter((field) => (local?.[field] ?? null) !== (record?.[field] ?? null))
    .map((field) => ({
      field,
      local: local?.[field] ?? null,
      record: record?.[field] ?? null,
    }));
  const localKinds = JSON.stringify(local?.judgeErrorKinds ?? []);
  const recordKinds = JSON.stringify(record?.judgeErrorKinds ?? []);
  if (localKinds !== recordKinds) {
    mismatches.push({
      field: "judgeErrorKinds",
      local: local?.judgeErrorKinds ?? [],
      record: record?.judgeErrorKinds ?? [],
    });
  }
  return { ok: mismatches.length === 0, mismatches };
}

function round4(value) {
  return Number(value.toFixed(4));
}

/**
 * 创建外部 run 时上送的知识上下文：运行范围 + 开跑前指纹。
 * 指纹读不到（端点异常）时不写该字段，服务端会按缺失记 stable=false。
 */
export function buildKnowledgeCreateFields({
  scope = null,
  fingerprintBefore = null,
} = {}) {
  const fields = {};
  if (scope === "full" || scope === "subset") fields.scope = scope;
  if (fingerprintBefore) fields.knowledgeFingerprintBefore = fingerprintBefore;
  return fields;
}

/** 收尾上送的开跑前/收尾前指纹；缺一项就少一项，让服务端能区分缺失。 */
export function buildKnowledgeIngestFields({
  fingerprintBefore = null,
  fingerprintAfter = null,
} = {}) {
  const fields = {};
  if (fingerprintBefore) fields.knowledgeFingerprintBefore = fingerprintBefore;
  if (fingerprintAfter) fields.knowledgeFingerprintAfter = fingerprintAfter;
  return fields;
}

/**
 * 服务端 health 的 commitSha 是「部署真值」，优先于本地 git/GIT_SHA。
 * 本地未注入时后端返回 unknown，必须当作缺失，不能覆盖本地 git sha。
 */
export function readServerCommitSha(health) {
  const sha = health?.commitSha;
  if (typeof sha !== "string") return null;
  const trimmed = sha.trim();
  return trimmed && trimmed !== "unknown" ? trimmed : null;
}

/** 用例快照 + 指纹：只含实际会写进外部 run 的用例。 */
export function buildExternalSnapshot(testCases, { fingerprint, goldenParts = [] } = {}) {
  const cases = testCases.map((item) => {
    const question =
      (item.turns ?? []).filter(Boolean).join("\n") ||
      item.question ||
      "";
    return {
      caseId: item.id,
      ...(item.kind ? { kind: item.kind } : {}),
      question: truncateQuestion(question),
      expectedDocIds: item.expectedDocIds ?? [],
      ...(item.lang ? { lang: item.lang } : {}),
    };
  });
  if (typeof fingerprint !== "function") {
    throw new Error("buildExternalSnapshot 需要注入 fingerprint 函数");
  }
  return {
    datasetFingerprint: fingerprint([
      ...goldenParts,
      ...cases.map((item) => item.caseId),
    ]),
    cases,
  };
}
