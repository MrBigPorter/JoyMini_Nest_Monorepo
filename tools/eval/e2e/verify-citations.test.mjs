import assert from "node:assert/strict";
import test from "node:test";

import {
  isCitationEligible,
  parseCitationArgs,
  renderCitationReview,
  runCitationReview,
  selectCitationCases,
  verdictFlipped,
} from "./verify-citations.mjs";

function caseOf(overrides = {}) {
  return {
    id: "knowledge:r01",
    kind: "knowledge",
    status: "ok",
    expectedDocIds: ["refund-policy"],
    judge: {
      grounding: { kind: "kb" },
      goldenAgreement: { faithful: true, reason: "ok" },
    },
    rounds: [
      {
        question: "退款多久到账？",
        reply: {
          content: "5 个工作日到账。",
          sources: [{ docId: "refund-policy" }],
        },
      },
    ],
    ...overrides,
  };
}

function withVerdicts({ id, v1, v2, docs = ["refund-policy"], cited }) {
  return caseOf({
    id,
    expectedDocIds: docs,
    judge: {
      grounding: { kind: "kb" },
      goldenAgreementV1: { faithful: v1 },
      goldenAgreement: { faithful: v2, reason: "recorded" },
    },
    rounds: [
      {
        question: `${id} question`,
        reply: {
          content: "answer",
          sources: (cited ?? docs).map((docId) => ({ docId })),
        },
      },
    ],
  });
}

test("isCitationEligible：只收 kb 依据、非兜底、有可核对文档的用例", () => {
  assert.equal(isCitationEligible(caseOf()), true);
  assert.equal(
    isCitationEligible(caseOf({ judge: { grounding: { kind: "tool" } } })),
    false,
  );
  // 旧报告没写 grounding：按引用判断，不能整批丢弃。
  assert.equal(
    isCitationEligible(caseOf({ judge: { goldenAgreement: { faithful: true } } })),
    true,
  );
  assert.equal(
    isCitationEligible(
      caseOf({
        rounds: [
          {
            question: "q",
            reply: {
              content:
                "人工客服暂时不在线，您可以先留言，我们会尽快联系您",
              sources: [{ docId: "refund-policy" }],
            },
          },
        ],
      }),
    ),
    false,
  );
  assert.equal(
    isCitationEligible(
      caseOf({
        expectedDocIds: [],
        rounds: [
          {
            question: "q",
            reply: { content: "answer", sources: [] },
          },
        ],
      }),
    ),
    false,
  );
});

test("verdictFlipped：旧口径与实际判决相反才算翻转", () => {
  assert.equal(
    verdictFlipped(withVerdicts({ id: "a", v1: false, v2: true })),
    true,
  );
  assert.equal(
    verdictFlipped(withVerdicts({ id: "b", v1: true, v2: true })),
    false,
  );
  assert.equal(verdictFlipped(caseOf()), false);
});

test("selectCitationCases：全量优先翻转、再变更文档，并遵守上限", () => {
  const cases = [
    caseOf({ id: "knowledge:plain" }),
    withVerdicts({ id: "knowledge:changed", v1: true, v2: true, docs: ["vip-benefits"] }),
    withVerdicts({ id: "knowledge:flip", v1: false, v2: true }),
    caseOf({ id: "action:1", kind: "action" }),
  ];
  const selected = selectCitationCases(cases, {
    scope: "full",
    limit: 2,
    docIds: ["vip-benefits"],
  });
  assert.deepEqual(
    selected.map((item) => item.id),
    ["knowledge:flip", "knowledge:changed"],
  );
});

test("selectCitationCases：子集全查，忽略上限", () => {
  const cases = Array.from({ length: 12 }, (_, index) =>
    caseOf({ id: `knowledge:${index}` }),
  );
  const selected = selectCitationCases(cases, { scope: "subset", limit: 1 });
  assert.equal(selected.length, 12);
});

test("runCitationReview：用注入判官逐条核验，记录翻转", async () => {
  const calls = [];
  const records = await runCitationReview({
    cases: [
      withVerdicts({ id: "knowledge:flip", v1: false, v2: true }),
      withVerdicts({ id: "knowledge:ok", v1: true, v2: true }),
    ],
    admin: {},
    scope: "subset",
    concurrency: 2,
    judge: async (payload) => {
      calls.push(payload);
      return {
        faithful: payload.question.startsWith("knowledge:flip") ? false : true,
        reason: "stub",
      };
    },
  });
  assert.equal(calls.length, 2);
  const flip = records.find((record) => record.id === "knowledge:flip");
  assert.equal(flip.recorded.faithful, true);
  assert.equal(flip.verdict.faithful, false);
  assert.deepEqual(flip.expectedDocIds, ["refund-policy"]);
  assert.equal(flip.citedDocIds.length, 0);
});

test("renderCitationReview：写入口径、逐条结果与人工抽检勾选项", () => {
  const records = [
    {
      id: "knowledge:flip",
      question: "退款多久到账？",
      expectedDocIds: ["refund-policy"],
      citedDocIds: ["shipping-policy"],
      recorded: { faithful: true, reason: "old" },
      previous: { faithful: false },
      flipped: true,
      verdict: { faithful: false, reason: "new" },
    },
  ];
  const markdown = renderCitationReview({
    records,
    runName: "20261124-005755",
    scope: "full",
    generatedAt: "2026-11-24T00:00:00.000Z",
    runMeta: { judgeSpecVersion: "v2" },
  });
  assert.match(markdown, /运行：20261124-005755/);
  assert.match(markdown, /判官输入规范：judgeSpecVersion=v2/);
  assert.match(markdown, /判决翻转/);
  assert.match(markdown, /引用漂移/);
  assert.match(markdown, /- \[ \] 抽检结论/);
});

test("parseCitationArgs：解析 scope / limit / doc-ids / out", () => {
  const args = parseCitationArgs([
    "detail.json",
    "--scope",
    "subset",
    "--limit",
    "5",
    "--doc-ids",
    "a, b",
    "--out",
    "out",
    "--concurrency",
    "99",
  ]);
  assert.equal(args.input, "detail.json");
  assert.equal(args.scope, "subset");
  assert.equal(args.limit, 5);
  assert.deepEqual(args.docIds, ["a", "b"]);
  assert.equal(args.out, "out");
  assert.equal(args.concurrency, 8);
  assert.throws(() => parseCitationArgs(["detail.json", "--scope", "x"]), /subset/);
});
