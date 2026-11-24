import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRunMetadata,
  maskPhonesInText,
  pickPoolEntry,
  sanitize,
} from "./run.mjs";
import {
  buildExternalSnapshot,
  classifyJudgeError,
  toExternalResult,
} from "./external-sync.mjs";

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
    metricSpecVersion: "1",
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
  assert.equal(meta.metricSpecVersion, "1");
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
  assert.equal(quota.judgeErrorKind, "rate_limit");
});

test("classifyJudgeError：五类错误归档", () => {
  assert.equal(classifyJudgeError("429 Too Many Requests"), "rate_limit");
  assert.equal(classifyJudgeError("judge_error: timed out"), "timeout");
  assert.equal(classifyJudgeError("401 unauthorized"), "auth");
  assert.equal(classifyJudgeError("blocked by content policy"), "policy");
  assert.equal(classifyJudgeError("unparseable output"), "output_format");
});
