import assert from "node:assert/strict";
import test from "node:test";

import {
  answerAccuracy,
  answeredRate,
  hitAt3Rate,
  isApplicableJudged,
  isJudgeError,
  judgeErrorKinds,
  judgeErrorRate,
  METRIC_SPEC_VERSION,
  p95Latency,
  ungroundedRisk,
} from "./metrics-spec.mjs";

const correct = { faithful: true, score: 1, reason: "ok" };
const incorrect = { faithful: false, score: 0, reason: "contradicts" };
const judgeFailure = (errorKind) => ({
  faithful: null,
  score: null,
  reason: `judge_error: ${errorKind}`,
  errorKind,
});
const notApplicable = {
  faithful: null,
  score: null,
  reason: "no_sources",
  errorKind: "not_applicable",
};

test("版本号固定为 2", () => {
  assert.equal(METRIC_SPEC_VERSION, 2);
});

test("answerAccuracy：correct/(correct+incorrect)，judge_error 与不适用不进分母", () => {
  const result = answerAccuracy([
    correct,
    correct,
    incorrect,
    judgeFailure("timeout"),
    notApplicable,
  ]);
  assert.deepEqual(result, {
    judged: 3,
    correct: 2,
    incorrect: 1,
    accuracy: 2 / 3,
  });
  assert.equal(isApplicableJudged(judgeFailure("timeout")), false);
  assert.equal(isApplicableJudged(notApplicable), false);
});

test("judgeErrorRate：只统计判官失败；harness/not_applicable/未调用不进分母", () => {
  const bucket = judgeErrorRate([
    correct,
    incorrect,
    judgeFailure("timeout"),
    judgeFailure("rate_limit"),
    notApplicable,
    { faithful: null, errorKind: "harness", reason: "harness_error" },
  ]);
  assert.equal(bucket.failures, 2);
  assert.equal(bucket.attempted, 4); // correct、incorrect、2 个判官失败
  assert.equal(bucket.successes, 2);
  assert.equal(bucket.total, 4);
  assert.equal(bucket.pct, 50);

  assert.equal(isJudgeError(notApplicable), false);
  assert.equal(isJudgeError({ faithful: null, errorKind: "harness" }), false);
  assert.equal(isJudgeError({ faithful: null, reason: "judge_error: boom" }), true);
});

test("judgeErrorKinds：按失败类型计数并降序", () => {
  assert.deepEqual(
    judgeErrorKinds([
      judgeFailure("timeout"),
      judgeFailure("timeout"),
      judgeFailure("auth"),
      correct,
    ]),
    [
      { kind: "timeout", count: 2 },
      { kind: "auth", count: 1 },
    ],
  );
});

test("answeredRate：兜底话术不算已答，分母是全部轮次", () => {
  const bucket = answeredRate([
    { rounds: [{ reply: { content: "3-5 天" } }] },
    { rounds: [{ reply: { content: "人工客服暂时不在线，您可以先留言，我们会尽快联系您" } }] },
    { rounds: [{ reply: { content: "" } }] },
  ]);
  assert.equal(bucket.successes, 1);
  assert.equal(bucket.total, 3);
});

test("hitAt3Rate：只统计有 golden 文档且做过检索判定的用例", () => {
  const bucket = hitAt3Rate([
    { expectedDocIds: ["d"], judge: { retrieval: { hitAt3: true } } },
    { expectedDocIds: ["d"], judge: { retrieval: { hitAt3: false } } },
    // 负样本没有 golden，不进分母
    { expectedDocIds: [], judge: { retrieval: { hitAt3: false } } },
    // 没跑检索判定，不进分母
    { expectedDocIds: ["d"], judge: {} },
  ]);
  assert.equal(bucket.successes, 1);
  assert.equal(bucket.total, 2);
});

test("p95Latency：按全部轮次的最近秩", () => {
  const cases = [
    { rounds: [{ latencyMs: 100 }, { latencyMs: 200 }] },
    { rounds: [{ latencyMs: 300 }, { latencyMs: 400 }] },
    { rounds: [{ latencyMs: 500 }] },
  ];
  assert.equal(p95Latency(cases), 500);
  assert.equal(p95Latency([]), null);
});

test("ungroundedRisk：只算知识类里 grounding=none 且发布事实断言的条数", () => {
  const risky = {
    kind: "knowledge",
    judge: { grounding: { kind: "none" } },
    groundingGate: { factualAssertion: true },
  };
  assert.equal(
    ungroundedRisk([
      risky,
      { ...risky, groundingGate: { factualAssertion: false } }, // 纯澄清不算
      { ...risky, judge: { grounding: { kind: "none" }, canned: true } }, // 兜底不算
      { ...risky, kind: "action" }, // 非知识类不算
      { ...risky, judge: { grounding: { kind: "kb" } } }, // 有依据不算
    ]),
    1,
  );
});
