import assert from "node:assert/strict";
import test from "node:test";

import {
  applyGrounding,
  collectMessageIds,
  groundingSql,
  parseGroundingRows,
} from "./traces.mjs";
import {
  buildCalibration,
  parseRejudgeArgs,
  selectRejudgeCases,
  stashV1,
} from "./rejudge.mjs";
import { CANNED_REPLIES } from "./judge.mjs";

function knowledgeCase(id, { messageId, content, sources = [], golden = null }) {
  return {
    id,
    kind: "knowledge",
    status: "ok",
    expectedDocIds: ["doc-1"],
    rounds: [
      {
        question: "问题",
        reply: { messageId, content, sources },
      },
    ],
    judge: {
      answered: Boolean(content),
      retrieval: { citedDocIds: sources.map((item) => item.docId) },
      goldenAgreement: golden,
    },
  };
}

test("groundingSql：只接受安全 id，空集合返回 null", () => {
  assert.equal(groundingSql([]), null);
  assert.equal(groundingSql(["bad id; drop table x"]), null);
  const sql = groundingSql(["cmwth31nk0285om4420tibi9e"]);
  assert.match(sql, /in \('cmwth31nk0285om4420tibi9e'\)/);
});

test("parseGroundingRows：跳过 SET 行，解析意图/flow/来源数/工具", () => {
  const map = parseGroundingRows(
    [
      "SET",
      "m1|kyc|GENERAL|0|getIdTypes|tool|shadow|allow",
      "m2|rag|POLICY|3||kb||",
      "m3|order|GENERAL|0|||shadow|degrade",
      "",
    ].join("\n"),
  );
  assert.equal(map.size, 3);
  assert.deepEqual(map.get("m1"), {
    intent: "kyc",
    flow: "GENERAL",
    ragSourceCount: 0,
    tools: ["getIdTypes"],
    grounding: "tool",
    groundingGate: { mode: "shadow", decision: "allow" },
  });
  assert.deepEqual(map.get("m2"), {
    intent: "rag",
    flow: "POLICY",
    ragSourceCount: 3,
    tools: [],
    grounding: "kb",
    groundingGate: null,
  });
  // 旧 trace 没写 grounding：保持 null，交给回退推断；门禁决定单独解析
  assert.equal(map.get("m3").grounding, null);
  assert.deepEqual(map.get("m3").groundingGate, {
    mode: "shadow",
    decision: "degrade",
  });
});

test("collectMessageIds：多轮取全部回答 id", () => {
  const cases = [
    knowledgeCase("a", { messageId: "m1", content: "答" }),
    {
      ...knowledgeCase("b", { messageId: "m2", content: "答" }),
      rounds: [
        { question: "q1", reply: { messageId: "m2", content: "x" } },
        { question: "q2", reply: { messageId: "m3", content: "y" } },
      ],
    },
  ];
  assert.deepEqual(collectMessageIds(cases), ["m1", "m2", "m3"]);
});

test("applyGrounding：工具类不判 B，兜底不算回答", () => {
  const toolCase = knowledgeCase("tool", {
    messageId: "m1",
    content: "SSS ID 等 11 种",
    golden: { applicable: true, faithful: false },
  });
  const fallbackCase = knowledgeCase("fb", {
    messageId: "m2",
    content: CANNED_REPLIES[0].text,
    golden: { applicable: true, faithful: true },
  });
  const map = new Map([
    ["m1", { intent: "kyc", flow: "GENERAL", ragSourceCount: 0, tools: ["getIdTypes"] }],
    ["m2", { intent: "rag", flow: "POLICY", ragSourceCount: 2, tools: [] }],
  ]);
  const [tool, fallback] = applyGrounding([toolCase, fallbackCase], map);

  assert.equal(tool.judge.grounding.kind, "tool");
  assert.equal(tool.judge.goldenAgreement.applicable, false);
  assert.equal(tool.judge.goldenAgreement.reason, "tool_data_not_in_sources");

  assert.equal(fallback.judge.grounding.kind, "fallback");
  assert.equal(fallback.judge.answered, false);
  assert.equal(fallback.judge.goldenAgreement.reason, "canned_reply");
});

test("applyGrounding：kb 组保持可判，classify 优先级 tool > kb", () => {
  const item = knowledgeCase("kb", {
    messageId: "m1",
    content: "TLS 1.3",
    sources: [{ docId: "doc-1" }],
    golden: { applicable: true, faithful: true },
  });
  const [result] = applyGrounding(
    [item],
    new Map([["m1", { intent: "rag", ragSourceCount: 3, tools: [] }]]),
  );
  assert.equal(result.judge.grounding.kind, "kb");
  assert.equal(result.judge.goldenAgreement.applicable, true);

  const [withTool] = applyGrounding(
    [item],
    new Map([["m1", { intent: "rag", ragSourceCount: 3, tools: ["getBalance"] }]]),
  );
  assert.equal(withTool.judge.grounding.kind, "tool");
});

test("stashV1 + selectRejudgeCases：只重判「知识库依据」的真实回答", () => {
  const cases = [
    knowledgeCase("kb", { messageId: "m1", content: "答", golden: { faithful: true } }),
    knowledgeCase("tool", { messageId: "m2", content: "答", golden: { faithful: false } }),
    knowledgeCase("canned", {
      messageId: "m3",
      content: CANNED_REPLIES[1].text,
      golden: { faithful: true },
    }),
  ];
  const map = new Map([
    ["m1", { ragSourceCount: 2, tools: [] }],
    ["m2", { ragSourceCount: 0, tools: ["getBalance"] }],
    ["m3", { ragSourceCount: 2, tools: [] }],
  ]);
  const stashed = stashV1(applyGrounding(cases, map));
  const targets = selectRejudgeCases(stashed).map((item) => item.id);
  assert.deepEqual(targets, ["kb"]);
  assert.equal(stashed[0].judge.goldenAgreementV1.faithful, true);
});

test("buildCalibration：对照组一致率与翻真/翻假清单", () => {
  const make = (id, v1, v2, docs = ["doc-1"]) => ({
    id,
    expectedDocIds: docs,
    rounds: [{ question: "q", reply: { content: "a" } }],
    judge: { goldenAgreementV1: { faithful: v1 } },
    rejudge: { goldenAgreement: { faithful: v2, reason: "r" } },
  });
  const calibration = buildCalibration(
    [
      make("same", true, true),
      make("flip-up", false, true),
      make("flip-down", true, false),
      make("multi", true, false, ["doc-1", "doc-2"]),
    ],
    new Map([["doc-1", 5]]),
  );
  assert.equal(calibration.compared, 4);
  assert.equal(calibration.control.total, 3);
  assert.equal(calibration.control.agree, 1);
  assert.deepEqual(calibration.control.disagree.map((row) => row.id), [
    "flip-up",
    "flip-down",
  ]);
  assert.deepEqual(calibration.flippedToFaithful.map((row) => row.id), ["flip-up"]);
  assert.deepEqual(calibration.flippedToUnfaithful.map((row) => row.id), [
    "flip-down",
    "multi",
  ]);
});

test("parseRejudgeArgs：输入、输出与并发", () => {
  assert.deepEqual(parseRejudgeArgs(["in.json", "--out", "o", "--concurrency", "2"]), {
    input: "in.json",
    out: "o",
    concurrency: 2,
    limit: 0,
    includeCited: false,
  });
  assert.equal(
    parseRejudgeArgs(["in.json", "--include-cited"]).includeCited,
    true,
  );
});

test("applyGrounding：优先用 trace metadata 的分型，缺失时回退推断", () => {
  const item = knowledgeCase("kb", {
    messageId: "m1",
    content: "TLS 1.3",
    golden: { applicable: true, faithful: true },
  });

  // metadata 明确写了 tool：即使 ragSourceCount>0 也以运行时记录为准
  const [declared] = applyGrounding(
    [item],
    new Map([
      [
        "m1",
        {
          intent: "rag",
          ragSourceCount: 3,
          tools: [],
          grounding: "tool",
        },
      ],
    ]),
  );
  assert.equal(declared.judge.grounding.kind, "tool");
  assert.equal(declared.judge.grounding.source, "trace_metadata");
  assert.equal(declared.judge.goldenAgreement.applicable, false);

  // 旧 trace 没写 grounding：退回按来源数/工具推断
  const [inferred] = applyGrounding(
    [item],
    new Map([
      [
        "m1",
        {
          intent: "rag",
          ragSourceCount: 3,
          tools: [],
          grounding: null,
        },
      ],
    ]),
  );
  assert.equal(inferred.judge.grounding.kind, "kb");
  assert.equal(inferred.judge.grounding.source, "inferred");
});
