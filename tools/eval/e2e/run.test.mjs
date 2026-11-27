import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRunMetadata,
  maskPhonesInText,
  pickPoolEntry,
  sanitize,
} from "./run.mjs";
import {
  HARNESS_METRIC_SPEC_VERSION,
  buildExternalSnapshot,
  buildKnowledgeCreateFields,
  buildKnowledgeIngestFields,
  classifyJudgeError,
  compareSummaryWithRecord,
  readServerCommitSha,
  summarizeExternalResults,
  toExternalResult,
} from "./external-sync.mjs";
import { loadConfig } from "./config.mjs";
import {
  filterCasesToSubset,
  selectSubsetFromFullRun,
} from "./cases.mjs";

function poolEntry(index, extra = {}) {
  return { index, busy: false, exhausted: false, reserved: false, ...extra };
}

test("pickPoolEntry：知识题不碰保留账号", () => {
  const entries = [
    poolEntry(0, { reserved: true }),
    poolEntry(1),
    poolEntry(2),
  ];
  const chosen = pickPoolEntry(entries, 0);
  assert.equal(chosen.index, 1);
  assert.equal(pickPoolEntry(entries, 1).index, 1);
  assert.equal(pickPoolEntry(entries, 2).index, 2);
});

test("pickPoolEntry：非保留账号全耗尽时才借用保留账号", () => {
  const exhausted = [poolEntry(1, { exhausted: true }), poolEntry(2, { exhausted: true })];
  const reserved = poolEntry(0, { reserved: true });
  assert.equal(pickPoolEntry([reserved, ...exhausted], 0).index, 0);
});

test("pickPoolEntry：允许保留账号时按轮转取，全耗尽返回 null", () => {
  const entries = [poolEntry(0, { reserved: true }), poolEntry(1)];
  assert.equal(pickPoolEntry(entries, 0, { allowReserved: true }).index, 0);
  assert.equal(
    pickPoolEntry([
      poolEntry(0, { exhausted: true }),
      poolEntry(1, { exhausted: true }),
    ], 0),
    null,
  );
});


test("sanitize：凭据字段整棵剔除（含嵌套与数组）", () => {
  const input = {
    id: "action:withdraw",
    confirm: { action: "withdraw", confirmToken: "secret-token", title: "确认提现" },
    rounds: [
      { outcome: "confirm", confirm: { needsOtp: true } },
      { accessToken: "abc", nested: { refreshToken: "r", ok: 1 } },
    ],
    judge: { pass: true },
  };
  const output = sanitize(input);
  const text = JSON.stringify(output);
  assert.equal(text.includes("secret-token"), false);
  assert.equal(text.includes("accessToken"), false);
  assert.equal(text.includes("refreshToken"), false);
  assert.equal(output.confirm.action, "withdraw");
  assert.equal(output.rounds[0].confirm.needsOtp, true);
  assert.equal(output.rounds[1].nested.ok, 1);
});

test("sanitize：手机号在任何字符串里都打码", () => {
  const output = sanitize({
    question: "我的电话是 09171234567",
    reply: { content: "联系 +639171234567 即可" },
  });
  assert.equal(output.question.includes("09171234567"), false);
  assert.equal(output.reply.content.includes("+639171234567"), false);
  assert.match(output.question, /0917/);
  assert.match(output.reply.content, /\+63917\*\*\*\*/);
});

test("maskPhonesInText：不误伤订单号/金额", () => {
  assert.equal(maskPhonesInText("订单 ORD-20261123 金额 ₱200"), "订单 ORD-20261123 金额 ₱200");
  assert.equal(maskPhonesInText("+639171234567"), "+63917****");
  assert.equal(maskPhonesInText("09171234567"), "091712****");
});

// ── 评测闭环 · 外部运行元数据与结果映射 ──────────────────────────────

test("buildRunMetadata：代码/门禁/判官/指标四维齐全", () => {
  const meta = buildRunMetadata({
    env: { GIT_SHA: "f00dcafe" },
    git: { sha: "f00dca", fullSha: "f00dcafe1234", branch: "b" },
    readEnv: (key) =>
      ({ AI_GROUNDING_GATE: "shadow", EVAL_JUDGE_SPEC: "v1" })[key],
  });
  assert.deepEqual(meta, {
    codeVersion: "f00dcafe",
    gateMode: "shadow",
    judgeSpecVersion: "v1",
    metricSpecVersion: "3",
  });
});

test("buildRunMetadata：CI 无 GIT_SHA 用完整 sha；缺门禁配置时默认 shadow", () => {
  const meta = buildRunMetadata({
    env: {},
    git: { sha: "abc1234", fullSha: "abc1234567890", branch: "b" },
    readEnv: () => undefined,
  });
  assert.equal(meta.codeVersion, "abc1234567890");
  assert.equal(meta.gateMode, "shadow");
  assert.equal(meta.judgeSpecVersion, "v2");
  assert.equal(meta.metricSpecVersion, "3");
});

test("buildRunMetadata：服务端 health 的 commitSha 优先于本地 GIT_SHA", () => {
  const meta = buildRunMetadata({
    env: { GIT_SHA: "local-fallback" },
    git: { sha: "abc1234", fullSha: "abc1234567890", branch: "b" },
    readEnv: () => undefined,
    serverCommitSha: "deployed-sha",
  });
  assert.equal(meta.codeVersion, "deployed-sha");
});

test("readServerCommitSha：部署注入值可用，unknown/缺失视为没有", () => {
  assert.equal(readServerCommitSha({ commitSha: " abc123 " }), "abc123");
  assert.equal(readServerCommitSha({ commitSha: "unknown" }), null);
  assert.equal(readServerCommitSha({ commitSha: "" }), null);
  assert.equal(readServerCommitSha({ ok: true }), null);
  assert.equal(readServerCommitSha(null), null);
});

test("buildKnowledgeCreateFields：scope 与开跑前指纹按存在上送", () => {
  assert.deepEqual(
    buildKnowledgeCreateFields({
      scope: "subset",
      fingerprintBefore: "abc",
    }),
    { scope: "subset", knowledgeFingerprintBefore: "abc" },
  );
  assert.deepEqual(
    buildKnowledgeCreateFields({ scope: "full", fingerprintBefore: null }),
    { scope: "full" },
  );
  assert.deepEqual(buildKnowledgeCreateFields({ scope: "weird" }), {});
});

test("buildKnowledgeIngestFields：缺一侧就少一侧，服务端可区分缺失", () => {
  assert.deepEqual(
    buildKnowledgeIngestFields({
      fingerprintBefore: "before",
      fingerprintAfter: "after",
    }),
    {
      knowledgeFingerprintBefore: "before",
      knowledgeFingerprintAfter: "after",
    },
  );
  assert.deepEqual(
    buildKnowledgeIngestFields({ fingerprintBefore: "before" }),
    { knowledgeFingerprintBefore: "before" },
  );
  assert.deepEqual(buildKnowledgeIngestFields({}), {});
});

test("loadConfig：E2E_SCOPE 默认 full，允许 subset，拒绝其他值", () => {
  assert.equal(loadConfig({}).scope, "full");
  assert.equal(
    loadConfig({ E2E_SCOPE: "subset", E2E_DOC_IDS: "doc-a" }).scope,
    "subset",
  );
  assert.equal(loadConfig({ E2E_SCOPE: " FULL " }).scope, "full");
  assert.throws(
    () => loadConfig({ E2E_SCOPE: "partial" }),
    /E2E_SCOPE must be full or subset/,
  );
});

test("loadConfig：E2E_SCOPE=subset 需要 E2E_DOC_IDS，并默认只跑知识与多轮", () => {
  assert.throws(
    () => loadConfig({ E2E_SCOPE: "subset" }),
    /E2E_SCOPE=subset 需要 E2E_DOC_IDS/,
  );
  const config = loadConfig({
    E2E_SCOPE: "subset",
    E2E_DOC_IDS: " shipping-policy , refund-policy ",
    E2E_BASE_RUN_ID: "run-full-1",
    E2E_INCLUDE_NEGATIVES: "1",
  });
  assert.deepEqual(config.docIds, ["shipping-policy", "refund-policy"]);
  assert.deepEqual(config.kinds, ["knowledge", "multi"]);
  assert.equal(config.baseRunId, "run-full-1");
  assert.equal(config.includeNegatives, true);
});

test("selectSubsetFromFullRun：无全量快照时明确要求先跑全量", () => {
  const missing = selectSubsetFromFullRun(null, ["doc-a"]);
  assert.match(missing.error, /需先跑一次全量/);
  assert.deepEqual(missing.caseIds, []);

  const noSnapshot = selectSubsetFromFullRun(
    { id: "run-1", scope: "full", datasetSnapshot: null },
    ["doc-a"],
  );
  assert.match(noSnapshot.error, /需先跑一次全量/);
  assert.match(noSnapshot.error, /没有用例快照/);

  const subsetRun = selectSubsetFromFullRun(
    { id: "run-2", scope: "subset", datasetSnapshot: { cases: [] } },
    ["doc-a"],
  );
  assert.match(subsetRun.error, /不是 full/);
});

test("selectSubsetFromFullRun：用全量快照的 caseId 映射受影响用例", () => {
  const run = {
    id: "run-full",
    scope: "full",
    datasetSnapshot: {
      cases: [
        { caseId: "knowledge:a", expectedDocIds: ["doc-a"] },
        { caseId: "knowledge:b", expectedDocIds: ["doc-b"] },
        { caseId: "multi:a+c", expectedDocIds: ["doc-a", "doc-c"] },
        { caseId: "action:x", expectedDocIds: [] },
      ],
    },
  };
  const result = selectSubsetFromFullRun(run, ["doc-a"]);
  assert.equal(result.error, null);
  assert.deepEqual(result.caseIds, ["knowledge:a", "multi:a+c"]);
});

test("filterCasesToSubset：只保留映射命中的用例，空集合返回空", () => {
  const cases = [
    { id: "knowledge:a" },
    { id: "knowledge:b" },
    { id: "multi:a+c" },
  ];
  assert.deepEqual(
    filterCasesToSubset(cases, ["knowledge:b"]).map((item) => item.id),
    ["knowledge:b"],
  );
  assert.deepEqual(filterCasesToSubset(cases, new Set()), []);
});

test("buildExternalSnapshot：多轮问句合并、指纹覆盖实际用例集", () => {
  const snapshot = buildExternalSnapshot(
    [
      {
        id: "knowledge:delivery",
        kind: "knowledge",
        turns: ["多久送达？", "宿务呢？"],
        expectedDocIds: ["shipping-policy"],
        lang: "zh",
      },
      { id: "read:balance", kind: "read", turns: ["我的余额是多少"], expectedDocIds: [] },
    ],
    { fingerprint: (parts) => parts.join("|"), goldenParts: ["golden"] },
  );
  assert.equal(snapshot.datasetFingerprint, "golden|knowledge:delivery|read:balance");
  assert.equal(snapshot.cases[0].question, "多久送达？\n宿务呢？");
  assert.deepEqual(snapshot.cases[0].expectedDocIds, ["shipping-policy"]);
});

test("buildExternalSnapshot：子集与全量落在不同数据集指纹", () => {
  const all = [
    { id: "knowledge:a", kind: "knowledge", turns: ["q1"], expectedDocIds: ["doc-a"] },
    { id: "knowledge:b", kind: "knowledge", turns: ["q2"], expectedDocIds: ["doc-b"] },
  ];
  const fingerprint = (parts) => parts.join("|");
  const full = buildExternalSnapshot(all, { fingerprint, goldenParts: ["golden"] });
  const subset = buildExternalSnapshot([all[0]], {
    fingerprint,
    goldenParts: ["golden"],
  });
  assert.notEqual(subset.datasetFingerprint, full.datasetFingerprint);
  assert.equal(subset.datasetFingerprint, "golden|knowledge:a");
});

test("toExternalResult：知识类按 golden 判定映射三态", () => {
  const base = {
    id: "knowledge:delivery",
    kind: "knowledge",
    status: "ok",
    judge: { grounding: { kind: "kb" } },
    rounds: [{ latencyMs: 1200, reply: { content: "3-5 天" } }],
  };
  const correct = toExternalResult({
    ...base,
    judge: {
      ...base.judge,
      goldenAgreement: { faithful: true, score: 1, reason: "supported" },
    },
  });
  assert.equal(correct.answerVerdict, "correct");
  assert.equal(correct.grounding, "kb");
  assert.equal(correct.latencyMs, 1200);

  const wrong = toExternalResult({
    ...base,
    judge: {
      ...base.judge,
      goldenAgreement: { faithful: false, score: 0, reason: "contradicts" },
    },
  });
  assert.equal(wrong.answerVerdict, "incorrect");
  assert.equal(wrong.answerScore, 0);

  const judgeErr = toExternalResult({
    ...base,
    judge: {
      ...base.judge,
      goldenAgreement: {
        faithful: null,
        reason: "judge_error: timed out after 30s",
      },
    },
  });
  assert.equal(judgeErr.answerVerdict, "judge_error");
  assert.equal(judgeErr.judgeErrorKind, "timeout");
});

test("toExternalResult：判官没给结论时归为不适用，不得归为输出格式", () => {
  const shell = {
    id: "negative:no-docs",
    kind: "negative",
    status: "ok",
    judge: { grounding: { kind: "kb" }, goldenAgreement: { applicable: true } },
    rounds: [{ reply: { content: "答" } }],
  };
  const result = toExternalResult(shell);

  assert.equal(result.answerVerdict, "judge_error");
  assert.equal(result.judgeErrorKind, "not_applicable");
  assert.notEqual(result.judgeErrorKind, "output_format");
  assert.match(result.reason, /^not_applicable: /);
});

test("toExternalResult：逐次判官尝试随结果上送，含原始输出与失败类别", () => {
  const result = toExternalResult({
    id: "knowledge:refund",
    kind: "knowledge",
    status: "ok",
    judge: {
      grounding: { kind: "kb" },
      goldenAgreement: {
        applicable: true,
        faithful: true,
        score: 1,
        reason: "supported",
        judgeInputHash: "hash-1",
        judgeSpecVersion: "v3",
        judgeAttempts: [
          {
            faithful: true,
            score: 1,
            reason: "supported",
            rawOutput: '{"faithful":true}',
            rawTruncated: false,
          },
          {
            faithful: null,
            score: null,
            reason: "judge_parse_failed",
            errorKind: "output_format",
            rawOutput: "not json",
            rawTruncated: false,
          },
          {
            faithful: null,
            score: null,
            reason: "judge_error",
            errorKind: "timeout",
            // 调用失败没有原始输出：保留缺失，不补空串。
          },
        ],
      },
    },
    rounds: [{ reply: { content: "3-5 天" } }],
  });

  assert.equal(result.judgeAttempts.length, 3);
  assert.deepEqual(result.judgeAttempts[0], {
    attemptIndex: 0,
    outcome: "success",
    score: 1,
    rawOutput: '{"faithful":true}',
    rawTruncated: false,
    judgeVersion: "v3",
    judgeInputHash: "hash-1",
  });
  assert.equal(result.judgeAttempts[1].outcome, "parse_failed");
  assert.equal(result.judgeAttempts[1].errorKind, "output_format");
  assert.equal(result.judgeAttempts[1].rawOutput, "not json");
  assert.equal(result.judgeAttempts[2].outcome, "call_error");
  assert.equal(result.judgeAttempts[2].errorKind, "timeout");
  assert.equal("rawOutput" in result.judgeAttempts[2], false);
});

test("toExternalResult：旧判官响应没有逐次明细时不上送该字段", () => {
  const result = toExternalResult({
    id: "knowledge:delivery",
    kind: "knowledge",
    status: "ok",
    judge: {
      grounding: { kind: "kb" },
      goldenAgreement: { faithful: true, score: 1, reason: "supported" },
    },
    rounds: [{ reply: { content: "3-5 天" } }],
  });

  assert.equal("judgeAttempts" in result, false);
});

test("toExternalResult：结构化失败类别优先于自由文本原因", () => {
  const result = toExternalResult({
    id: "knowledge:auth",
    kind: "knowledge",
    status: "ok",
    judge: {
      grounding: { kind: "kb" },
      goldenAgreement: {
        applicable: true,
        faithful: null,
        errorKind: "auth",
        reason: "judge_error: timed out after 30s",
      },
    },
    rounds: [{ reply: { content: "答" } }],
  });

  assert.equal(result.answerVerdict, "judge_error");
  assert.equal(result.judgeErrorKind, "auth");
});

test("toExternalResult：真实超时仍记超时", () => {
  const result = toExternalResult({
    id: "knowledge:timeout",
    kind: "knowledge",
    status: "ok",
    judge: {
      grounding: { kind: "kb" },
      goldenAgreement: {
        faithful: null,
        reason: "judge_error: timed out after 30s",
      },
    },
    rounds: [{ reply: { content: "答" } }],
  });

  assert.equal(result.answerVerdict, "judge_error");
  assert.equal(result.judgeErrorKind, "timeout");
});

test("summarizeExternalResults：空壳判定不计入判官失败率", () => {
  const shell = (id) =>
    toExternalResult({
      id,
      kind: "negative",
      status: "ok",
      judge: { grounding: { kind: "kb" }, goldenAgreement: { applicable: true } },
      rounds: [{ reply: { content: "答" } }],
    });
  const correct = toExternalResult({
    id: "knowledge:ok",
    kind: "knowledge",
    status: "ok",
    judge: {
      grounding: { kind: "kb" },
      goldenAgreement: { faithful: true, score: 1, reason: "supported" },
    },
    rounds: [{ reply: { content: "答" } }],
  });

  const local = summarizeExternalResults([
    shell("a"),
    shell("b"),
    shell("c"),
    correct,
  ]);

  assert.equal(local.total, 4);
  assert.equal(local.correct, 1);
  assert.equal(local.judgeErrorRate, 0);
  assert.deepEqual(local.judgeErrorKinds, []);
});

test("toExternalResult：任务完成度/安全断言不并入答案准确性", () => {
  for (const kind of ["action", "read", "boundary"]) {
    const result = toExternalResult({
      id: `${kind}:x`,
      kind,
      status: "ok",
      judge: { pass: true, grounding: { kind: "tool" } },
      rounds: [{ reply: { content: "ok" } }],
    });
    assert.equal(result.answerVerdict, "judge_error");
    assert.equal(result.judgeErrorKind, "not_applicable");
  }
});

test("toExternalResult：harness 失败与配额跳过都不计为回答错误", () => {
  const errored = toExternalResult({
    id: "knowledge:x",
    kind: "knowledge",
    status: "error",
    errorMessage: "socket reset",
    rounds: [],
  });
  assert.equal(errored.answerVerdict, "judge_error");
  assert.equal(errored.judgeErrorKind, "harness");
  assert.match(errored.reason, /harness_error/);

  const quota = toExternalResult({
    id: "knowledge:y",
    kind: "knowledge",
    status: "skipped",
    skipReason: "账号今日 AI 配额已耗尽",
    rounds: [],
  });
  assert.equal(quota.judgeErrorKind, "harness");
});

test("classifyJudgeError：五类错误归档", () => {
  assert.equal(classifyJudgeError("429 Too Many Requests"), "rate_limit");
  assert.equal(classifyJudgeError("judge_error: timed out"), "timeout");
  assert.equal(classifyJudgeError("401 unauthorized"), "auth");
  assert.equal(classifyJudgeError("blocked by content policy"), "policy");
  assert.equal(classifyJudgeError("unparseable output"), "output_format");
});

test("HARNESS_METRIC_SPEC_VERSION 跟随指标规范升到 3", () => {
  assert.equal(HARNESS_METRIC_SPEC_VERSION, "3");
});

test("summarizeExternalResults：与服务端同口径，排除 harness/not_applicable", () => {
  const local = summarizeExternalResults([
    { answerVerdict: "correct" },
    { answerVerdict: "incorrect" },
    { answerVerdict: "judge_error", judgeErrorKind: "timeout" },
    { answerVerdict: "judge_error", judgeErrorKind: "timeout" },
    { answerVerdict: "judge_error", judgeErrorKind: "harness" },
    { answerVerdict: "judge_error", judgeErrorKind: "not_applicable" },
  ]);

  assert.deepEqual(local, {
    total: 6,
    correct: 1,
    incorrect: 1,
    judgeError: 4,
    accuracy: 0.5,
    judgedCases: 2,
    coverage: 0.3333,
    // 判官实际调用 4 次（2 次成功 + 2 次 timeout），失败 2 次
    judgeErrorRate: 0.5,
    judgeErrorKinds: [{ kind: "timeout", count: 2 }],
    // 没有重复采样证据：稳定性无定义
    judgeAgreement: null,
    judgeAgreementMeasured: 0,
    judgeDisagreement: 0,
    scope: "full",
    selectedCaseCount: null,
  });
});

test("summarizeExternalResults：子集记录 scope 与登记用例数", () => {
  const local = summarizeExternalResults([{ answerVerdict: "correct" }], {
    scope: "subset",
    selectedCaseCount: 7,
  });
  assert.equal(local.scope, "subset");
  assert.equal(local.selectedCaseCount, 7);
});

test("summarizeExternalResults：覆盖率按入库条数计算，跳过计入总数不计入已判", () => {
  const local = summarizeExternalResults([
    { answerVerdict: "correct" },
    { answerVerdict: "incorrect" },
    { answerVerdict: "judge_error", judgeErrorKind: "harness" },
    { answerVerdict: "judge_error", judgeErrorKind: "not_applicable" },
  ]);
  assert.equal(local.total, 4);
  assert.equal(local.judgedCases, 2);
  assert.equal(local.coverage, 0.5);
});

test("summarizeExternalResults：零条时覆盖率为 null", () => {
  const local = summarizeExternalResults([]);
  assert.equal(local.judgedCases, 0);
  assert.equal(local.coverage, null);
});

test("compareSummaryWithRecord：覆盖率不一致被指出", () => {
  const local = summarizeExternalResults([{ answerVerdict: "correct" }]);
  const { ok, mismatches } = compareSummaryWithRecord(local, {
    ...local,
    coverage: 0.5,
  });
  assert.equal(ok, false);
  assert.deepEqual(
    mismatches.map((item) => item.field),
    ["coverage"],
  );
});

test("summarizeExternalResults：judgeAgreement 只统计 ≥2 次成功的用例", () => {
  const judged = (agreement, attempts, disagreement = false) => ({
    answerVerdict: "correct",
    judgeAgreement: agreement,
    judgeSuccessfulAttempts: attempts,
    judgeDisagreement: disagreement,
  });
  const local = summarizeExternalResults([
    judged(1, 3), // 全票
    judged(1, 3), // 全票
    judged(0.67, 3), // 2:1，分母内但不算一致
    judged(0.5, 2, true), // 平票 → judge_error 但仍然测量到分歧
    judged(1, 1, true), // 成功不足，不进分母
    { answerVerdict: "correct" }, // 旧数据，没有逐次证据
  ]);
  assert.equal(local.judgeAgreementMeasured, 4);
  assert.equal(local.judgeDisagreement, 1);
  assert.equal(local.judgeAgreement, 0.5);
});

test("toExternalResult：把重复采样证据带给服务端", () => {
  const result = toExternalResult({
    id: "knowledge:delivery",
    kind: "knowledge",
    status: "ok",
    judge: {
      grounding: { kind: "kb" },
      goldenAgreement: {
        faithful: true,
        score: 1,
        reason: "ok",
        judgeAgreement: 0.67,
        judgeSuccessfulAttempts: 3,
        judgeDisagreement: false,
      },
    },
    rounds: [{ reply: { content: "3-5 天" } }],
  });
  assert.equal(result.judgeAgreement, 0.67);
  assert.equal(result.judgeSuccessfulAttempts, 3);
  assert.equal("judgeDisagreement" in result, false);
});

test("compareSummaryWithRecord：逐字段核对库内 summary", () => {
  const local = summarizeExternalResults([
    {
      answerVerdict: "correct",
      judgeAgreement: 1,
      judgeSuccessfulAttempts: 3,
    },
    { answerVerdict: "judge_error", judgeErrorKind: "timeout" },
  ]);
  const record = {
    total: 2,
    correct: 1,
    incorrect: 0,
    judgeError: 1,
    accuracy: 1,
    judgedCases: 1,
    coverage: 0.5,
    judgeErrorRate: 0.5,
    judgeErrorKinds: [{ kind: "timeout", count: 1 }],
    judgeAgreement: 1,
    judgeAgreementMeasured: 1,
    judgeDisagreement: 0,
    scope: "full",
    selectedCaseCount: null,
  };

  assert.deepEqual(compareSummaryWithRecord(local, record), {
    ok: true,
    mismatches: [],
  });

  const mismatch = compareSummaryWithRecord(local, {
    ...record,
    judgeAgreement: 0.9,
  });
  assert.equal(mismatch.ok, false);
  assert.deepEqual(
    mismatch.mismatches.map((item) => item.field),
    ["judgeAgreement"],
  );
});
