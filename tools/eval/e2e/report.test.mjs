import assert from "node:assert/strict";
import test from "node:test";

import { formatRate, percentile, rate, renderSummary, summarize, wilson } from "./report.mjs";

test("wilson：区间夹住点估计且落在 [0,1]", () => {
  const interval = wilson(8, 10);
  assert.ok(interval.low < 0.8 && interval.high > 0.8);
  assert.ok(interval.low >= 0 && interval.high <= 1);
  assert.deepEqual(wilson(0, 0), { low: null, high: null });
});

test("rate/formatRate：分子分母原样写出，0/0 不写成 0%", () => {
  const bucket = rate(9, 12);
  assert.equal(bucket.successes, 9);
  assert.equal(bucket.total, 12);
  assert.match(formatRate(bucket), /^9\/12 = 75\.0%（95% CI /);
  assert.match(formatRate(rate(0, 0)), /0\/0/);
});

test("percentile：p50/p95 按最近秩", () => {
  const values = [10, 20, 30, 40, 50];
  assert.equal(percentile(values, 50), 30);
  assert.equal(percentile(values, 95), 50);
  assert.equal(percentile([], 50), null);
});

function knowledgeCase(overrides = {}) {
  return {
    id: "knowledge:x",
    kind: "knowledge",
    status: "ok",
    rounds: [{ latencyMs: 1000, reply: { content: "答案" } }],
    judge: {
      answered: true,
      faithfulness: { faithful: true },
      goldenAgreement: { faithful: true },
      retrieval: { hitAt1: true, hitAt3: true, citedDocIds: ["d"] },
      language: { pass: true, skipped: false },
    },
    ...overrides,
  };
}

test("summarize：忠实度只按「判了的」算分母，skip 不算失败", () => {
  const cases = [
    knowledgeCase(),
    knowledgeCase({
      id: "knowledge:y",
      judge: {
        answered: true,
        faithfulness: null,
        goldenAgreement: { faithful: false },
        retrieval: { hitAt1: false, hitAt3: true, citedDocIds: [] },
        language: { pass: true, skipped: false },
      },
    }),
    { id: "knowledge:z", kind: "knowledge", status: "skipped", skipReason: "fixture blocked", rounds: [] },
    { id: "multi:a", kind: "multi", status: "ok", rounds: [{ reply: { content: "一" } }, { reply: { content: "二" } }], judge: {}, repeatSimilarity: 0.2 },
  ];
  const summary = summarize(cases);

  assert.deepEqual(summary.totals, { cases: 4, ok: 3, skipped: 1, errored: 0 });
  assert.equal(summary.knowledge.answered.total, 2);
  assert.equal(summary.knowledge.faithful.total, 1); // 只有 1 条判了忠实度
  assert.equal(summary.knowledge.goldenAgreement.total, 2);
  assert.equal(summary.knowledge.hitAt1.total, 2);
  assert.equal(summary.multi.answeredSecond.total, 1);
  assert.equal(summary.reliability.skippedReasons[0].key, "fixture blocked");
});

test("summarize：只有不支持点全是联系方式时才算脱敏伪差异", () => {
  const failed = (id, claims) =>
    knowledgeCase({
      id,
      rounds: [
        {
          latencyMs: 1000,
          reply: { content: "请联系 p***@joymini.com 处理" },
        },
      ],
      judge: {
        answered: true,
        faithfulness: null,
        goldenAgreement: { faithful: false, unsupportedClaims: claims },
        retrieval: { hitAt1: true, hitAt3: true, citedDocIds: ["d"] },
        language: { pass: true, skipped: false },
      },
    });
  const summary = summarize([
    failed("knowledge:pii", ["联系邮箱 p***@joymini.com 不在来源里"]),
    failed("knowledge:rights", [
      "权利可在 Account → Privacy Settings 管理",
      "联系邮箱 p***@joymini.com 不在来源里",
    ]),
  ]);

  assert.deepEqual(summary.knowledge.failures.piiMasked, ["knowledge:pii"]);
  assert.deepEqual(summary.knowledge.failures.contentMismatch, [
    "knowledge:rights",
  ]);
});

test("summarize：动作按验证结果计数，边界按断言计数", () => {
  const summary = summarize([
    {
      id: "action:claim_coupon",
      kind: "action",
      status: "ok",
      action: "claim_coupon",
      judge: {
        pass: true,
        cardShown: true,
        confirmAction: "claim_coupon",
        actionResultSuccess: true,
        verification: { pass: true },
      },
    },
    {
      id: "action:withdraw",
      kind: "action",
      status: "ok",
      action: "withdraw",
      judge: {
        pass: false,
        cardShown: true,
        confirmAction: "withdraw",
        actionResultSuccess: false,
        verification: { pass: false },
      },
    },
    {
      id: "boundary:injection",
      kind: "boundary",
      status: "ok",
      assert: "no_prompt_leak_and_no_execution",
      judge: { pass: true, detail: "未泄露" },
    },
  ]);

  assert.equal(summary.actions.total, 2);
  assert.equal(summary.actions.passed, 1);
  assert.equal(summary.boundaries.total, 1);
  assert.equal(summary.boundaries.passed.successes, 1);
});

test("renderSummary：v3 主口径、严格诊断与判官一致性三行并列", () => {
  const meta = {
    startedAt: "2026-11-23T10:00:00Z",
    finishedAt: "2026-11-23T10:30:00Z",
    apiBaseUrl: "http://localhost:3000/api",
    businessId: "simulation_support_v1",
    trafficSource: "e2e_acceptance_v1",
    gitSha: "abc1234",
    branch: "feat/x",
    accountCount: 12,
    concurrency: 4,
    datasetFingerprint: "deadbeef1234",
    chatModel: "deepseek-chat",
    judgeModel: "deepseek-chat",
  };
  const merged = knowledgeCase({
    id: "knowledge:merged",
    judge: {
      answered: true,
      faithfulness: null,
      goldenAgreement: null,
      retrieval: { hitAt1: true, hitAt3: true, citedDocIds: ["d"] },
      language: { pass: true, skipped: false },
    },
    rejudge: {
      goldenAgreement: {
        faithful: true,
        judgeAgreement: 1,
        judgeSuccessfulAttempts: 3,
        judgeDisagreement: false,
      },
      strictAgreement: { faithful: false },
    },
  });
  const split = knowledgeCase({
    id: "knowledge:split",
    judge: {
      answered: true,
      faithfulness: null,
      goldenAgreement: null,
      retrieval: { hitAt1: true, hitAt3: true, citedDocIds: ["d"] },
      language: { pass: true, skipped: false },
    },
    rejudge: {
      goldenAgreement: {
        faithful: true,
        judgeAgreement: 0.67,
        judgeSuccessfulAttempts: 3,
        judgeDisagreement: false,
      },
    },
  });

  const text = renderSummary({
    meta,
    fixtures: { log: [], blockers: [] },
    stats: { requests: 10, throttled: 0, retries: 0 },
    cases: [merged, split],
  });

  // 主 kbAccuracy 用合并口径（两条都 faithful）
  assert.match(text, /kbAccuracy（kb 组，只算判得动的） \| 2\/2 = 100\.0%/);
  // 严格诊断只统计有 strictAgreement 的 1 条
  assert.match(text, /严格口径诊断.*0\/1 = 0\.0%/);
  // 一致性：两条都有 ≥2 次成功，只有一条全票一致
  assert.match(text, /判官一致性（全票一致 \/ ≥2 次成功的用例） \| 1\/2 = 50\.0%/);
  assert.match(text, /判官分歧（平票或成功不足，记 judge_error） \| 0 条/);
});

test("renderSummary：输出结论表、动作明细与判定口径", () => {
  const text = renderSummary({
    meta: {
      startedAt: "2026-11-23T10:00:00Z",
      finishedAt: "2026-11-23T10:30:00Z",
      apiBaseUrl: "http://localhost:3000/api",
      businessId: "simulation_support_v1",
      trafficSource: "e2e_acceptance_v1",
      gitSha: "abc1234",
      branch: "feat/x",
      accountCount: 12,
      concurrency: 4,
      datasetFingerprint: "deadbeef1234",
      chatModel: "deepseek-chat",
      judgeModel: "llama-3.3-70b-versatile",
    },
    fixtures: { log: [{ step: "coupon_claim", status: "updated", detail: "续期到 +30d" }], blockers: [] },
    stats: { requests: 100, throttled: 0, retries: 1 },
    cases: [knowledgeCase()],
  });

  assert.match(text, /# 真实账号端到端 AI 客服验收/);
  assert.match(text, /知识问答 · 有回复 \| 1\/1 = 100\.0%/);
  assert.match(text, /知识问答 · kbAccuracy（kb 组，只算判得动的） \| 1\/1 = 100\.0%/);
  assert.match(text, /coupon_claim：续期到 \+30d/);
  assert.match(text, /忠实度（A）/);
  assert.match(text, /未覆盖与已知限制/);
  assert.match(text, /`update_address` 使用 1 句人工补题/);
});
