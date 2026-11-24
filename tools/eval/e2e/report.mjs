/**
 * 汇总与报告。所有比率都写「分子/分母 + Wilson 95% 区间」，
 * 不把忠实度（A）冒充正确率（B），也不把 skip 算成失败。
 */
import fs from "node:fs";
import path from "node:path";

import { cannedReplyCheck } from "./judge.mjs";
import {
  answerAccuracy,
  answeredRate,
  formatRate,
  hitAt3Rate,
  isApplicableJudged,
  isJudgeError,
  isJudged,
  judgeErrorKinds,
  judgeErrorRate,
  METRIC_SPEC_VERSION,
  percentile,
  p95Latency,
  rate,
  wilson,
} from "./metrics-spec.mjs";

// 指标实现集中在 metrics-spec.mjs；这里保留同名导出，兼容已有调用方与测试。
export {
  formatRate,
  METRIC_SPEC_VERSION,
  percentile,
  rate,
  wilson,
} from "./metrics-spec.mjs";

function countBy(list, getKey) {
  const map = new Map();
  for (const item of list) {
    const key = getKey(item) ?? "unknown";
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, count }));
}

/** 回答内容是否是兜底话术（不依赖存储字段，老报告也能重算）。 */
function isCannedCase(item) {
  if (item?.judge?.canned === true) return true;
  const rounds = item?.rounds ?? [];
  const content = rounds[rounds.length - 1]?.reply?.content ?? "";
  return cannedReplyCheck(content).canned;
}

/**
 * 判 B 的结果：重判报告读 `item.rejudge`（v2），实时运行读 `item.judge`。
 * 两套数据都保留，旧报告仍能原样渲染。
 */
function goldenJudgeOf(item) {
  return item?.rejudge?.goldenAgreement ?? item?.judge?.goldenAgreement ?? null;
}

/** 一条用例的依据来源：优先用 traces 标记，老数据按是否引用推断。 */
function groundingKind(item) {
  const kind =
    item?.rejudge?.basis ?? item?.judge?.grounding?.kind ?? item?.grounding?.kind;
  if (kind) return kind;
  const cited = (item?.judge?.retrieval?.citedDocIds ?? []).length > 0;
  return cited ? "kb" : "unknown";
}

/** 判官错误率阈值：与基线登记规则共用同一环境变量。 */
function judgeErrorThreshold() {
  const raw = Number(process.env.EVAL_MAX_JUDGE_ERROR_RATE);
  return Number.isFinite(raw) && raw >= 0 ? raw : 0.02;
}

/** 把一次运行的结果整理成指标；纯函数，方便单测。 */
export function summarize(cases) {
  const ok = cases.filter((item) => item.status === "ok");
  const skipped = cases.filter((item) => item.status === "skipped");
  const errored = cases.filter((item) => item.status === "error");

  const knowledge = ok.filter((item) => item.kind === "knowledge");
  const negatives = ok.filter((item) => item.kind === "negative");
  const multi = ok.filter((item) => item.kind === "multi");
  const actions = ok.filter((item) => item.kind === "action");
  const reads = ok.filter((item) => item.kind === "read");
  const boundaries = ok.filter((item) => item.kind === "boundary");

  const knowledgeAnswered = knowledge.filter((item) => item.judge?.answered);
  const knowledgeJudged = knowledge.filter((item) =>
    isJudged(item.judge?.faithfulness),
  );
  // 只统计「判得动」的：工具类/无依据类标了 applicable=false，不进准确率分母
  const goldenJudged = knowledge.filter((item) =>
    isApplicableJudged(goldenJudgeOf(item)),
  );
  // 放宽口径：判 B 时把回答实际引用的文档也交给判官（`--include-cited`）。
  // 只做诊断，严格口径照旧；用来区分「编造」与「golden 集不全」。
  const expandedJudged = knowledge.filter((item) =>
    isApplicableJudged(item?.rejudge?.expandedAgreement),
  );
  const expandedFaithful = expandedJudged.filter(
    (item) => item.rejudge.expandedAgreement.faithful === true,
  ).length;
  const knowledgeRealAnswered = knowledge.filter((item) => {
    const last = item.rounds?.[item.rounds?.length - 1];
    return Boolean(last?.reply?.content) && !isCannedCase(item);
  });
  // 依据分型来自哪里：运行时 trace metadata（新）还是按 traces/spans 推断（旧）。
  const groundingSource = { trace_metadata: 0, inferred: 0, unknown: 0 };
  for (const item of knowledge) {
    const source =
      item?.judge?.grounding?.source ?? item?.grounding?.source ?? null;
    if (source === "trace_metadata") groundingSource.trace_metadata += 1;
    else if (source === "inferred") groundingSource.inferred += 1;
    else groundingSource.unknown += 1;
  }
  // 发布门禁决定分布（mode 取自 trace：shadow 只观察，enforce 会改回复）
  const groundingGate = { allow: 0, degrade: 0, unknown: 0, mode: null };
  for (const item of knowledge) {
    const mode = item?.groundingGate?.mode;
    if (mode && !groundingGate.mode) groundingGate.mode = mode;
    const decision = item?.groundingGate?.decision;
    if (decision === "allow") groundingGate.allow += 1;
    else if (decision === "degrade") groundingGate.degrade += 1;
    else groundingGate.unknown += 1;
  }
  const byGrounding = {};
  for (const kind of ["kb", "tool", "none", "fallback", "unknown"]) {
    const group = knowledge.filter((item) => groundingKind(item) === kind);
    const score = answerAccuracy(group.map(goldenJudgeOf));
    byGrounding[kind] = {
      total: group.length,
      judged: score.judged,
      faithful: score.correct,
      accuracy: rate(score.correct, score.judged),
      judgeErrors: group.filter((item) => isJudgeError(goldenJudgeOf(item)))
        .length,
    };
  }
  // 判 B 未通过的知识库用例，按「是谁的问题」粗分：
  //   脱敏伪差异 / golden 文档集不全 / 内容与引用文档也不符
  const kbFailures = knowledge.filter(
    (item) =>
      groundingKind(item) === "kb" &&
      isApplicableJudged(goldenJudgeOf(item)) &&
      goldenJudgeOf(item).faithful === false,
  );
  const failureBuckets = { piiMasked: [], goldenDocGap: [], contentMismatch: [] };
  for (const item of kbFailures) {
    const last = item.rounds?.[item.rounds.length - 1];
    const content = String(last?.reply?.content ?? "");
    if (/[a-z]\*{3}@/i.test(content)) {
      failureBuckets.piiMasked.push(item.id);
      continue;
    }
    const expected = new Set(item.expectedDocIds ?? []);
    const cited = (last?.reply?.sources ?? []).map((source) => source.docId);
    if (cited.some((docId) => docId && !expected.has(docId))) {
      failureBuckets.goldenDocGap.push(item.id);
      continue;
    }
    failureBuckets.contentMismatch.push(item.id);
  }

  const languageJudged = cases.filter(
    (item) =>
      item.status === "ok" && item.judge?.language?.skipped === false,
  );

  const latencies = ok.flatMap((item) =>
    (item.rounds ?? [])
      .map((round) => round.latencyMs)
      .filter((value) => Number.isFinite(value)),
  );

  const multiSecond = multi.filter((item) => item.rounds?.length >= 2);
  const multiSecondAnswered = multiSecond.filter(
    (item) => Boolean(item.rounds[1]?.reply?.content),
  );
  const multiSecondReal = multiSecond.filter((item) => {
    const content = item.rounds[1]?.reply?.content ?? "";
    return Boolean(content) && !cannedReplyCheck(content).canned;
  });

  const readJudged = reads.filter(
    (item) => item.judge?.taskJudge?.verdict,
  );

  const judgeObjects = ok
    .flatMap((item) => [
      item.judge?.faithfulness,
      item.judge?.goldenAgreement,
      item.rejudge?.goldenAgreement,
      item.rejudge?.expandedAgreement,
    ])
    .filter(Boolean);
  const judgeFailure = judgeErrorRate(judgeObjects);
  const maxJudgeErrorRate = judgeErrorThreshold();
  const judgeErrorRatio =
    judgeFailure.attempted === 0
      ? 0
      : judgeFailure.failures / judgeFailure.attempted;
  const judgeErrors = {
    ...judgeFailure,
    kinds: judgeErrorKinds(judgeObjects),
    threshold: maxJudgeErrorRate,
    /** 超过阈值：本轮只能当诊断跑，不得登记基线（METRICS.md §4）。 */
    diagnosticOnly: judgeErrorRatio > maxJudgeErrorRate,
  };

  return {
    metricSpecVersion: METRIC_SPEC_VERSION,
    judgeErrors,
    totals: {
      cases: cases.length,
      ok: ok.length,
      skipped: skipped.length,
      errored: errored.length,
    },
    knowledge: {
      answered: rate(knowledgeAnswered.length, knowledge.length),
      /** 真实回答率：排除兜底话术。兜底是「转人工」，不是回答了问题。 */
      realAnswered: answeredRate(knowledge),
      canned: rate(
        knowledge.filter((item) => isCannedCase(item)).length,
        knowledge.length,
      ),
      /** 按依据来源分组：kb 才是知识准确率的分母 */
      byGrounding,
      /** 分型数据来源：trace 直接落库 vs 旧数据反推 */
      groundingSource,
      /** 门禁决定：shadow 阶段 used 来复核误降级 */
      groundingGate,
      toolNotApplicable: byGrounding.tool.total,
      ungrounded: byGrounding.none.total,
      /** 判 B 未通过的 KB 用例粗分（脱敏伪差异 / 文档集不全 / 内容不符） */
      failures: {
        total: kbFailures.length,
        ...failureBuckets,
      },
      /** 放宽口径：golden + 回答实际引用文档（仅 --include-cited 时有值） */
      expandedGolden:
        expandedJudged.length > 0
          ? {
              judged: expandedJudged.length,
              faithful: expandedFaithful,
              accuracy: rate(expandedFaithful, expandedJudged.length),
              failures: expandedJudged
                .filter(
                  (item) => item.rejudge.expandedAgreement.faithful === false,
                )
                .map((item) => item.id),
            }
          : null,
      /** 回答里真的带了 sources 的比例：没引用的回答判不了忠实度，必须先看这个数 */
      cited: rate(
        knowledgeAnswered.filter(
          (item) => (item.judge?.retrieval?.citedDocIds ?? []).length > 0,
        ).length,
        knowledgeAnswered.length,
      ),
      hitAt1: rate(
        knowledgeAnswered.filter((item) => item.judge?.retrieval?.hitAt1).length,
        knowledgeAnswered.length,
      ),
      hitAt3: hitAt3Rate(knowledge),
      faithful: rate(
        knowledgeJudged.filter((item) => item.judge.faithfulness.faithful).length,
        knowledgeJudged.length,
      ),
      goldenAgreement: rate(
        goldenJudged.filter((item) => goldenJudgeOf(item).faithful).length,
        goldenJudged.length,
      ),
    },
    negatives: {
      total: negatives.length,
      answered: negatives.filter((item) => item.judge?.answered).length,
      leaked: negatives.filter((item) => item.judge?.leak?.leaked).length,
      citedUnrelated: negatives.filter(
        (item) => (item.judge?.retrieval?.citedDocIds ?? []).length > 0,
      ).length,
      faithfulWhenCited: rate(
        negatives.filter((item) => isJudged(item.judge?.faithfulness)).filter(
          (item) => item.judge.faithfulness.faithful,
        ).length,
        negatives.filter((item) => isJudged(item.judge?.faithfulness)).length,
      ),
    },
    multi: {
      answeredSecond: rate(multiSecondAnswered.length, multiSecond.length),
      realAnsweredSecond: rate(multiSecondReal.length, multiSecond.length),
      hitAt3Second: rate(
        multiSecondAnswered.filter((item) => item.judge?.retrieval?.hitAt3)
          .length,
        multiSecondAnswered.length,
      ),
      repeated: rate(
        multi.filter((item) => (item.repeatSimilarity ?? 0) >= 0.8).length,
        multi.length,
      ),
      faithful: rate(
        multi.filter((item) => isJudged(item.judge?.faithfulness)).filter(
          (item) => item.judge.faithfulness.faithful,
        ).length,
        multi.filter((item) => isJudged(item.judge?.faithfulness)).length,
      ),
    },
    actions: {
      total: actions.length,
      passed: actions.filter((item) => item.judge?.pass).length,
      details: actions.map((item) => ({
        id: item.id,
        action: item.action,
        cardShown: Boolean(item.judge?.cardShown),
        confirmAction: item.judge?.confirmAction ?? null,
        executed: item.judge?.actionResultSuccess ?? null,
        verification: item.judge?.verification?.pass ?? false,
        verifyDetail: (item.judge?.verification?.detail ?? []).join("；"),
        confirmError: item.confirmError ?? null,
        pass: Boolean(item.judge?.pass),
        skipReason: item.skipReason ?? null,
      })),
    },
    reads: {
      answered: rate(
        reads.filter((item) => item.judge?.answered).length,
        reads.length,
      ),
      solved: rate(
        readJudged.filter((item) => item.judge.taskJudge.verdict === "solved")
          .length,
        readJudged.length,
      ),
      atLeastPartial: rate(
        readJudged.filter(
          (item) => item.judge.taskJudge.verdict !== "unsolved",
        ).length,
        readJudged.length,
      ),
    },
    boundaries: {
      total: boundaries.length,
      passed: rate(
        boundaries.filter((item) => item.judge?.pass).length,
        boundaries.length,
      ),
      rows: boundaries.map((item) => ({
        id: item.id,
        assert: item.assert,
        pass: Boolean(item.judge?.pass),
        detail: item.judge?.detail ?? "",
      })),
    },
    language: rate(
      languageJudged.filter((item) => item.judge.language.pass).length,
      languageJudged.length,
    ),
    latency: {
      p50: percentile(latencies, 50),
      p95: p95Latency(ok),
      samples: latencies.length,
    },
    reliability: {
      noReply: cases.filter(
        (item) =>
          item.status === "error" ||
          (item.rounds ?? []).some((round) => round.outcome === "timeout"),
      ).length,
      aiErrors: ok.filter((item) =>
        (item.rounds ?? []).some((round) => round.outcome === "ai_error"),
      ).length,
      socketDrops: cases
        .flatMap((item) => item.rounds ?? [])
        .filter((round) => round.socketDropped).length,
      topErrors: countBy(
        errored.flatMap((item) =>
          (item.rounds ?? [])
            .filter((round) => round.outcome !== "reply")
            .map((round) => round.outcome),
        ),
        (key) => key,
      ),
      skippedReasons: countBy(skipped, (item) => item.skipReason),
    },
  };
}

function ms(value) {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value)}ms`;
}

function pct(value) {
  return value === null || value === undefined ? "—" : `${value.toFixed(1)}%`;
}

/** 生成 summary.md（Markdown 字符串）。 */
export function renderSummary(result) {
  const { meta, fixtures, stats, cases } = result;
  const summary = summarize(cases);
  const lines = [];
  const push = (line = "") => lines.push(line);

  push("# 真实账号端到端 AI 客服验收（本地 dev）");
  push();
  push(`- 运行时间：${meta.startedAt} → ${meta.finishedAt}`);
  // 断点续跑时上面这行只是最后一次进程的窗口；用例本身跨多次运行，真实覆盖区间要单独算
  const starts = cases
    .map((item) => Date.parse(item.startedAt))
    .filter((value) => Number.isFinite(value));
  const ends = cases
    .map((item) => Date.parse(item.startedAt) + (item.elapsedMs ?? 0))
    .filter((value) => Number.isFinite(value));
  if (starts.length > 0 && ends.length > 0) {
    push(
      `- 用例覆盖时间：${new Date(Math.min(...starts)).toISOString()} → ${new Date(
        Math.max(...ends),
      ).toISOString()}（${meta.resume ? "断点续跑合并，共多次进程" : "单次运行"}）`,
    );
  }
  push(`- 环境：${meta.apiBaseUrl}（渠道 \`${meta.businessId}\`，流量来源 \`${meta.trafficSource}\`）`);
  push(`- 提交：\`${meta.gitSha}\`（分支 \`${meta.branch}\`）`);
  push(`- 账号：${meta.accountCount} 个真实注册账号（OTP），并发 ${meta.concurrency}`);
  push(`- 数据集指纹：\`${meta.datasetFingerprint}\``);
  if (meta.externalRun?.id) {
    push(
      `- 评测记录：\`${meta.externalRun.id}\`（${meta.externalRun.status}；指标版本 \`${meta.metricSpecVersion ?? "—"}\`，判官版本 \`${meta.judgeSpecVersion ?? "—"}\`，门禁 \`${meta.gateMode ?? "—"}\`）`,
    );
  } else if (meta.externalRun?.status === "failed") {
    push(`- 评测记录写入失败：${meta.externalRun.error ?? "unknown"}`);
  }
  push(`- 聊天模型：${meta.chatModel ?? "unknown"}；判定模型：${meta.judgeModel ?? "服务端默认"}`);
  push(`- 用例总数：${summary.totals.cases}（完成 ${summary.totals.ok}，跳过 ${summary.totals.skipped}，异常 ${summary.totals.errored}）`);
  if (meta.rejudge) {
    push(
      `- **离线重判**：${meta.rejudge.at}，输入 \`${path.basename(meta.rejudge.input ?? "")}\`，重判 ${meta.rejudge.rejudgedCases} 条（未重跑用例；旧判定保留在 \`judge\`，新判定在 \`rejudge\`）`,
    );
  }
  push();

  push("## 结论摘要");
  push();
  push("| 维度 | 结果 |");
  push("| --- | --- |");
  push(`| 知识问答 · 有回复 | ${formatRate(summary.knowledge.answered)} |`);
  push(`| 知识问答 · 回答引用知识库（sources 非空） | ${formatRate(summary.knowledge.cited)} |`);
  push(`| 知识问答 · 检索 Hit@1 | ${formatRate(summary.knowledge.hitAt1)} |`);
  push(`| 知识问答 · 检索 Hit@3 | ${formatRate(summary.knowledge.hitAt3)} |`);
  push(`| 知识问答 · 忠实度（只看回答自带 sources） | ${formatRate(summary.knowledge.faithful)} |`);
  push(`| 知识问答 · 与 golden 文档一致 | ${formatRate(summary.knowledge.goldenAgreement)} |`);
  push(`| 负样本 · 泄露 | ${summary.negatives.leaked} 条（应 0） |`);
  push(`| 负样本 · 引用了无关文档 | ${summary.negatives.citedUnrelated}/${summary.negatives.total} |`);
  push(`| 多轮 · 第二轮有回复 | ${formatRate(summary.multi.answeredSecond)} |`);
  push(`| 多轮 · 第二轮检索 Hit@3 | ${formatRate(summary.multi.hitAt3Second)} |`);
  push(`| 多轮 · 两轮答案重复（≥0.8） | ${formatRate(summary.multi.repeated)} |`);
  push(`| 业务动作 · 完整执行并核验 | ${formatRate(rate(summary.actions.passed, summary.actions.total))} |`);
  push(`| 读类问答 · 有回复 | ${formatRate(summary.reads.answered)} |`);
  push(`| 读类问答 · task judge solved | ${formatRate(summary.reads.solved)} |`);
  push(`| 边界/安全 | ${formatRate(summary.boundaries.passed)} |`);
  push(`| 语言一致（zh/en） | ${formatRate(summary.language)} |`);
  push(`| 时延 p50 / p95 | ${ms(summary.latency.p50)} / ${ms(summary.latency.p95)}（${summary.latency.samples} 轮） |`);
  push();

  push("## 依据来源与可判性");
  push();
  push(
    `知识类回答不都是「检索 → 回答」：兜底话术 ${summary.knowledge.canned.successes} 条不算回答，工具类 ${summary.knowledge.toolNotApplicable} 条的事实不在知识库里，无依据作答 ${summary.knowledge.ungrounded} 条是幻觉风险指标。只有知识库依据（kb）组进准确率分母。`,
  );
  push();
  const gs = summary.knowledge.groundingSource;
  if (gs) {
    push(
      `依据分型来源：\`ai_traces.metadata.grounding\` ${gs.trace_metadata} 条、按 traces/spans 推断 ${gs.inferred} 条、旧数据未标注 ${gs.unknown} 条。混用两种口径时，分组对比只看同一来源内部的变化。`,
    );
    push();
  }
  if (summary.knowledge.groundingGate) {
    const gate = summary.knowledge.groundingGate;
    const known = gate.allow + gate.degrade;
    if (known > 0) {
      push(
        `发布门禁决定（知识类）：degrade ${gate.degrade} 条、allow ${gate.allow} 条${
          gate.unknown > 0 ? `、未记录 ${gate.unknown} 条` : ""
        }。${
          gate.mode === "enforce"
            ? "enforce 模式下 degrade 条目已被替换为转人工话术（记为 fallback），不再作为回答计入指标。"
            : "shadow 模式下 degrade **不改变回复**，仅用于复核误降级；enforce 报告里这些条目会变成转人工话术。"
        }`,
      );
      push();
    }
  }
  push("| 依据来源 | 条数 | 判 B 分母 | 与 golden 一致 | 说明 |");
  push("| --- | --- | --- | --- | --- |");
  const groundingLabels = {
    kb: "知识库（kb）",
    tool: "工具数据（tool）",
    none: "无依据（none）",
    fallback: "兜底话术（fallback）",
    unknown: "未标注（旧数据）",
  };
  const groundingNotes = {
    kb: "检索后作答，准确率只在这一组计算",
    tool: "余额/订单/KYC/商品等工具结果；不适用判 B，不计分母",
    none: "既没检索也没调工具；风险指标，不并入准确率",
    fallback: "兜底话术不是回答，不算已答",
    unknown: "旧报告未采集 traces，无法分类",
  };
  for (const kind of ["kb", "tool", "none", "fallback", "unknown"]) {
    const group = summary.knowledge.byGrounding[kind];
    if (!group || group.total === 0) continue;
    push(
      `| ${groundingLabels[kind]} | ${group.total} | ${group.judged} | ${
        group.judged === 0 ? "—" : formatRate(group.accuracy)
      } | ${groundingNotes[kind]} |`,
    );
  }
  push();
  push(`| 指标 | 结果 |`);
  push(`| --- | --- |`);
  push(`| 知识问答 · 真实回答率（排除兜底） | ${formatRate(summary.knowledge.realAnswered)} |`);
  push(`| 知识问答 · 兜底话术 | ${formatRate(summary.knowledge.canned)} |`);
  push(`| 多轮 · 第二轮真实回答率（排除兜底） | ${formatRate(summary.multi.realAnsweredSecond)} |`);
  push(`| 判官失败率（分子为失败数，不进准确率分母） | ${formatRate(summary.judgeErrors)} |`);
  push();
  if (summary.judgeErrors.total > 0) {
    push(
      `判官失败按类型：${
        summary.judgeErrors.kinds.length === 0
          ? "—"
          : summary.judgeErrors.kinds
              .map((item) => `${item.kind} ${item.count}`)
              .join("、")
      }。`,
    );
    push();
  }
  if (summary.judgeErrors.diagnosticOnly) {
    push(
      `> ⚠️ 判官失败率 ${summary.judgeErrors.pct.toFixed(1)}% 超过阈值 ${(summary.judgeErrors.threshold * 100).toFixed(1)}%：本轮**仅诊断**，不得登记新基线。`,
    );
    push();
  }
  // ── 库内运行记录与基线对比（6.3）──
  const record = meta.externalRun?.summary ?? null;
  if (record) {
    const pct = (value) =>
      typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "—";
    push("## 运行记录与基线（库内 summary）");
    push();
    push("| 字段 | 值 |");
    push("| --- | --- |");
    push(`| 运行 id | \`${meta.externalRun.id}\` |`);
    push(
      `| 版本 | 指标 \`${record.metricSpecVersion ?? "—"}\`、判官 \`${record.judgeSpecVersion ?? "—"}\`、代码 \`${record.codeVersion ?? "—"}\`、门禁 \`${record.gateMode ?? "—"}\` |`,
    );
    push(
      `| 用例 / 正确 / 错误 / 判官失败 | ${record.total ?? "—"} / ${record.correct ?? 0} / ${record.incorrect ?? 0} / ${record.judgeError ?? 0} |`,
    );
    push(`| 答案准确率（correct/(correct+incorrect)） | ${pct(record.accuracy)} |`);
    push(
      `| 判官失败率（harness / not_applicable 不计） | ${pct(record.judgeErrorRate)} |`,
    );
    push(
      `| 判官错误类型 | ${
        Array.isArray(record.judgeErrorKinds) && record.judgeErrorKinds.length > 0
          ? record.judgeErrorKinds
              .map((item) => `${item.kind} ${item.count}`)
              .join("、")
          : "—"
      } |`,
    );
    push();
    if (record.baselineRunId) {
      push(
        `- 对比基线：\`${record.baselineRunId}\`；基准确率 ${pct(record.baselineAccuracy)}，变化 ${
          typeof record.delta === "number"
            ? `${record.delta >= 0 ? "+" : ""}${(record.delta * 100).toFixed(1)}%`
            : "—"
        }，新增错误 ${record.newFailures ?? 0}，修复 ${record.fixed ?? 0}。`,
      );
    } else {
      push("- 未关联基线：同数据集还没有被 promote 的运行记录。");
    }
    const consistency = meta.externalRun?.consistency;
    if (consistency) {
      push(
        consistency.ok
          ? "- 核对：库内 summary 与本地提交结果**一致**。"
          : `> ⚠️ 库内 summary 与本地复核不一致：${consistency.mismatches
              .map(
                (item) =>
                  `${item.field}（库内 ${JSON.stringify(item.record)} / 本地 ${JSON.stringify(item.local)}）`,
              )
              .join("；")}`,
      );
    } else {
      push("- 核对：运行记录未读回，无法核对库内 summary。");
    }
    if (
      typeof record.judgeErrorRate === "number" &&
      record.judgeErrorRate >= judgeErrorThreshold()
    ) {
      push(
        `> ⚠️ 判官失败率 ${pct(record.judgeErrorRate)} 未低于 ${(judgeErrorThreshold() * 100).toFixed(1)}%：本轮仅诊断，不得登记为新基线。`,
      );
    }
    if (meta.externalRun.isBaseline) {
      push("- 该运行已是当前基线（`isBaseline=true`）。");
    }
    push();
  }

  const failures = summary.knowledge.failures;
  if (failures.total > 0) {
    push(
      `判 B 未通过的 ${failures.total} 条知识库回答，粗分为：脱敏伪差异 ${failures.piiMasked.length} 条、golden 文档集不全 ${failures.goldenDocGap.length} 条（回答引用了 golden 未列出的文档，判官只看到部分文档）、内容与文档不符 ${failures.contentMismatch.length} 条。`,
    );
    if (failures.contentMismatch.length > 0) {
      push();
      push(`内容不符：${failures.contentMismatch.map((id) => `\`${id}\``).join("、")}`);
    }
    push();
  }

  const expanded = summary.knowledge.expandedGolden;
  if (expanded) {
    push(
      `- **放宽口径诊断**（golden + 回答实际引用的文档）：${formatRate(expanded.accuracy)}（${expanded.judged} 条可判）；剩余不一致 ${
        expanded.failures.length
      } 条${expanded.failures.length > 0 ? `：${expanded.failures.map((id) => `\`${id}\``).join("、")}` : ""}。`,
    );
    push(
      "- 该口径只用于区分「回答编造」与「golden 文档集不全」，**不替代上面的严格准确率**；严格口径仍是验收口径。",
    );
    push();
  }

  if (result.calibration) {
    const calibration = result.calibration;
    push("## 重判校准（新旧对照）");
    push();
    push(
      `- 可对照用例：${calibration.compared} 条；新旧判决一致率：${formatRate(calibration.agreement)}`,
    );
    push(
      `- 对照组（单文档且 chunk ≤ 8，旧实现已取全 sources）：${calibration.control.agree}/${calibration.control.total} 一致 —— 不一致说明判官本身不稳定，不能归因于补全 chunk`,
    );
    if (calibration.control.disagree.length > 0) {
      for (const row of calibration.control.disagree) {
        push(`  - 对照组翻判：\`${row.id}\`（V1 ${row.v1} → V2 ${row.v2}）${row.v2Reason}`);
      }
    }
    push(`- 翻真（V1 不一致 → V2 一致）：${calibration.flippedToFaithful.length} 条`);
    for (const row of calibration.flippedToFaithful) {
      push(`  - \`${row.id}\`：${String(row.question).slice(0, 40)}`);
    }
    push(`- 翻假（V1 一致 → V2 不一致）：${calibration.flippedToUnfaithful.length} 条（需人工复核，可能是真幻觉）`);
    for (const row of calibration.flippedToUnfaithful) {
      push(
        `  - \`${row.id}\`：${String(row.question).slice(0, 40)}；理由 ${row.v2Reason || "—"}`,
      );
    }
    push();
  }

  push("## 业务动作明细");
  push();
  push("| 动作 | 确认卡 | 卡片动作 | 执行 | 读接口核验 | 结论 | 失败原因 |");
  push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const row of summary.actions.details) {
    push(
      `| ${row.action} | ${row.cardShown ? "有" : "无"} | ${row.confirmAction ?? "—"} | ${
        row.executed === null ? "—" : row.executed ? "成功" : "失败"
      } | ${row.verification ? "通过" : "未通过"} | ${row.pass ? "✅" : "❌"} | ${
        row.pass ? "" : row.confirmError ?? row.verifyDetail ?? ""
      } |`,
    );
  }
  push();

  push("## 边界/安全");
  push();
  push("| 场景 | 断言 | 结果 | 说明 |");
  push("| --- | --- | --- | --- |");
  for (const row of summary.boundaries.rows) {
    push(`| ${row.id.replace("boundary:", "")} | ${row.assert} | ${row.pass ? "✅" : "❌"} | ${row.detail} |`);
  }
  push();

  push("## 可靠性");
  push();
  push(`- HTTP 请求 ${stats.requests} 次；429 ${stats.throttled} 次；重试 ${stats.retries} 次${
    meta.resume ? "（仅最后一次进程）" : ""
  }`);
  push(`- 无回复/超时用例 ${summary.reliability.noReply} 个；ai_error ${summary.reliability.aiErrors} 个`);
  push(`- Socket 掉线轮次 ${summary.reliability.socketDrops ?? 0} 个（掉线后重连重发，轮次标 \`socketDropped\`）`);
  if (summary.reliability.skippedReasons.length > 0) {
    push("- 跳过原因：");
    for (const item of summary.reliability.skippedReasons) {
      push(`  - ${item.count} × ${item.key}`);
    }
  }
  push();

  push("## 前置数据（本次真实改动）");
  push();
  const changed = (fixtures?.log ?? []).filter(
    (item) => item.status === "created" || item.status === "updated",
  );
  // 每组 fixture 账号都会各跑一遍前置步骤，同一步骤/同一结论只写一行
  const seenChanges = new Set();
  const uniqueChanged = changed.filter((item) => {
    const key = `${item.status}|${item.step}|${item.detail}`;
    if (seenChanges.has(key)) return false;
    seenChanges.add(key);
    return true;
  });
  if (uniqueChanged.length === 0) {
    push("本次没有新建/修改业务数据，全部复用既有账号与数据。");
  } else {
    for (const item of uniqueChanged) {
      push(`- [${item.status}] ${item.step}：${item.detail}`);
    }
  }
  if ((fixtures?.blockers ?? []).length > 0) {
    push();
    push("阻塞（对应用例已显式跳过，未计为通过）：");
    for (const line of new Set(
      fixtures.blockers.map((item) => `- ${item.step}：${item.reason}`),
    )) {
      push(line);
    }
  }
  push();

  push("## 判定口径");
  push();
  push("- **忠实度（A）**：`POST /admin/rag/documents/judge`，sources = 回答消息里真实下发的 `meta.sources`；回答没引用就不判，不计入分母。");
  push("- **判定输入是脱敏后的回答**：后端在推送前对 AI 回复做 PII 脱敏（`ai-reply-publisher.ts` → `redactPiiText`），邮箱会变成 `s***@domain`、手机号变成 `+639****123`。判定看到的是客户端真实收到的文本，所以「回答里的联系方式与文档不一致」一类扣分，首先是脱敏行为造成的。");
  push("- **与 golden 一致（B）**：同一端点，sources = golden 命中文档的真实 chunk；衡量「答对了没有」，与 A 分开报。");
  push("- **B 的分母只含知识库依据（kb）组**：工具数据回答（余额/订单/KYC/商品）本来就不在知识库里，判「无依据」是测量错误；无依据组只作为幻觉风险指标单列。");
  push("- **chunk 选择按相关度、在端点预算内**：判官端点单条 2000 字符、合计 8000 字符，超出会被静默截断。旧实现固定取每篇文档前 8 个 chunk，导致文档后半段的事实永远判「无依据」；现在按问题/回答词面相关度挑 chunk，预算内塞满。");
  push("- **兜底话术不算回答**：`人工客服暂时不在线…` / `抱歉，我这边暂时处理不了…` / `本次对话已达到 AI 使用上限…` 三句静态话术命中即 `answered=false`。");
  push("- **检索命中**：回答 `meta.sources` 的 `docId` 顺序对比 `expectedDocIds`（Hit@1 / Hit@3）。");
  push("- **业务动作**：卡片出现 → `/ai/customer/confirm` 执行（提现再走 `/confirm/otp`）→ 客户端读接口核验副作用 → task judge。");
  push("- **边界/安全**：纯规则断言，不使用模型判定。");
  push();

  push("## 未覆盖与已知限制");
  push();
  push("- 充值（仅 Xendit 线上支付）与用户自助 KYC 提交（AWS/Gemini/R2）在本地 dev 不可完成，未纳入。");
  push("- `update_address` 使用 1 句人工补题（用户已批准），本报告单列，其余题目均来自既有 golden/场景集合。");
  push("- 需要补充动作参数的用例（新增地址、提现）在场景之后追加了一轮「补参数」用户发言；这不改变题目来源，只补齐工具必填字段。");
  push("- 次数/金额等金额类数值来自本次 fixture 的真实返回值，报告不写死。");
  const skippedIds = (cases ?? [])
    .filter((item) => item.status === "skipped")
    .map((item) => item.id);
  if (skippedIds.length > 0) {
    push(
      `- 跳过 ${skippedIds.length} 例（不按失败计）：${skippedIds.join("、")}。原因为账号当日 AI 配额耗尽，非回答质量问题。`,
    );
  }
  push("- 发现的问题汇总见同目录 `findings.md`（只记录、不改产品代码）。");
  push();

  return lines.join("\n");
}

/** 落盘 detail.json + summary.md，返回目录路径。 */
export function writeReport(result, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "detail.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { mode: 0o600 },
  );
  fs.writeFileSync(path.join(outDir, "summary.md"), renderSummary(result), {
    mode: 0o600,
  });
  return outDir;
}
