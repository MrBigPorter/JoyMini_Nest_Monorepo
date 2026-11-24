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

/** 与 `metrics-spec.mjs` 上线前的历史报告口径对齐（Phase 2 升到 2）。 */
export const HARNESS_METRIC_SPEC_VERSION = "1";

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

/** 知识类（knowledge / negative / multi）的答案准确性判定。 */
function knowledgeVerdict(base, item) {
  const judge = item.judge ?? {};
  const golden = judge.goldenAgreement ?? null;

  if (golden) {
    if (golden.applicable === false) {
      return notApplicable(base, reasonOf(golden) || "golden_not_applicable");
    }
    if (golden.faithful === true) {
      return verdict(base, reasonOf(golden) || "golden_faithful", golden.score);
    }
    if (golden.faithful === false) {
      return incorrect(
        base,
        reasonOf(golden) || "golden_unfaithful",
        golden.score,
      );
    }
    return judgeError(
      base,
      classifyJudgeError(reasonOf(golden)),
      reasonOf(golden) || "golden_judge_returned_null",
    );
  }

  const faithfulness = judge.faithfulness ?? null;
  if (faithfulness) {
    if (faithfulness.faithful === true) {
      return verdict(
        base,
        reasonOf(faithfulness) || "faithful",
        faithfulness.score,
      );
    }
    if (faithfulness.faithful === false) {
      return incorrect(
        base,
        reasonOf(faithfulness) || "unfaithful",
        faithfulness.score,
      );
    }
    return judgeError(
      base,
      classifyJudgeError(reasonOf(faithfulness)),
      reasonOf(faithfulness) || "judge_returned_null",
    );
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
export function toExternalResult(item) {
  const last = lastRound(item);
  const grounding =
    item?.judge?.grounding?.kind ?? item?.grounding?.kind ?? "unknown";
  const base = {
    caseId: item.id,
    grounding,
    ...(Number.isFinite(last?.latencyMs)
      ? { latencyMs: Math.max(0, Math.round(last.latencyMs)) }
      : {}),
  };

  if (item.status === "skipped") {
    const reason = item.skipReason ?? "skipped";
    const kind = /quota|配额|上限|limit/i.test(reason)
      ? "rate_limit"
      : "harness";
    return judgeError(base, kind, `harness_skipped: ${reason}`);
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
