import assert from "node:assert/strict";
import test from "node:test";

import { runCheck } from "./runner.mjs";
import { SourceError } from "./source.mjs";
import { RegistryError } from "./registry.mjs";

const CHANNEL = {
  code: "PH_DEMO",
  name: "Demo",
  type: 1,
  minAmount: "50.00",
  maxAmount: "50000.00",
  feeRate: "0.0000",
  feeFixed: "0.00",
  status: 1,
};

function registryStub() {
  return {
    version: 1,
    documents: ["demo"],
    facts: {
      "PH_DEMO.fee": {
        docId: "demo",
        row: "Demo",
        column: "Fee",
        source: { kind: "payment_channel", code: "PH_DEMO", type: 1, fields: ["fee_rate", "fee_fixed"] },
        expectForm: "flat",
        parser: "channel-row-v1",
      },
    },
    unsourced: [],
  };
}

const GOOD_DOC = [
  "| Method | Processing Time | Min Amount | Max Amount | Fee |",
  "|:-------|:---------------:|:----------:|:----------:|:---:|",
  "| **Demo** | Instant | ₱50 | ₱50,000 | Free <!-- truth: PH_DEMO.fee --> |",
].join("\n");

function sourceStub(overrides = {}) {
  return {
    async listChannels(type) {
      return type === 1 ? [CHANNEL] : [];
    },
    async getDocument(docId) {
      return { docId, content: GOOD_DOC, version: 1, activeVersion: 1 };
    },
    async listActivePrompts() {
      return [{ name: "wallet", activeVersion: 5, config: { role: "You are the wallet assistant." } }];
    },
    ...overrides,
  };
}

test("来源不可达：判失败，blocker 写明原因，且不当作跳过", async () => {
  const report = await runCheck({
    loadRegistryFn: registryStub,
    source: sourceStub({
      async listChannels() {
        throw new SourceError("请求超时（15000ms）：GET /admin/payment/channels/list?type=1");
      },
    }),
  });
  assert.equal(report.status, "fail");
  assert.equal(report.results.length, 0);
  assert.match(report.blockers.join("\n"), /不可达/);
  assert.match(report.blockers.join("\n"), /超时/);
});

test("登记不可解析：判失败，blocker 带 RegistryError 原文", async () => {
  const report = await runCheck({
    loadRegistryFn() {
      throw new RegistryError("登记项 PH_X.fee 缺 parser");
    },
    source: sourceStub(),
  });
  assert.equal(report.status, "fail");
  assert.match(report.blockers.join("\n"), /登记不可解析/);
  assert.match(report.blockers.join("\n"), /PH_X\.fee/);
});

test("单元格不可解析：判失败，明细里带原文与原因", async () => {
  const report = await runCheck({
    loadRegistryFn: registryStub,
    source: sourceStub({
      async getDocument(docId) {
        return {
          docId,
          content: [
            "| Method | Processing Time | Min Amount | Max Amount | Fee |",
            "|:-------|:---------------:|:----------:|:----------:|:---:|",
            "| **Demo** | Instant | ₱50 | ₱50,000 | varies <!-- truth: PH_DEMO.fee --> |",
          ].join("\n"),
        };
      },
    }),
  });
  assert.equal(report.status, "fail");
  const failure = report.results.find((result) => result.reason === "unparseable");
  assert.ok(failure);
  assert.equal(failure.declared, "varies");
  assert.ok(failure.detail && failure.detail.length > 0);
});

test("零条比对：没有可比对声明也判失败，不静默通过", async () => {
  const report = await runCheck({
    loadRegistryFn() {
      return { version: 1, documents: [], facts: {}, unsourced: [] };
    },
    source: sourceStub(),
  });
  assert.equal(report.status, "fail");
  assert.equal(report.compared, 0);
  assert.match(report.blockers.join("\n"), /零条/);
});

test("全部一致：状态通过，compared 等于声明条数", async () => {
  const report = await runCheck({ loadRegistryFn: registryStub, source: sourceStub() });
  assert.equal(report.status, "pass");
  assert.equal(report.compared, 1);
  assert.equal(report.promptsScanned, 1);
  assert.deepEqual(report.blockers, []);
});

// 提示词是运行期可改的载体（管理端激活版本），写死费率/金额会绕过知识库文档的一致性约束。
test("提示词写死费率：判失败，指出提示词、版本与字面量，不继续比对", async () => {
  const report = await runCheck({
    loadRegistryFn: registryStub,
    source: sourceStub({
      async listActivePrompts() {
        return [
          {
            name: "wallet",
            activeVersion: 5,
            config: { role: "You are the wallet assistant.", domainRules: "Withdrawal fee is 0.8% of the amount." },
          },
        ];
      },
    }),
  });
  assert.equal(report.status, "fail");
  assert.equal(report.results.length, 0);
  const text = report.blockers.join("\n");
  assert.match(text, /提示词「wallet」v5/);
  assert.match(text, /0\.8%/);
});

test("提示词读取失败：判失败并写明原因，不当作没有提示词", async () => {
  const report = await runCheck({
    loadRegistryFn: registryStub,
    source: sourceStub({
      async listActivePrompts() {
        throw new SourceError("HTTP 500：GET /admin/ai-prompt?status=active");
      },
    }),
  });
  assert.equal(report.status, "fail");
  assert.equal(report.results.length, 0);
  assert.match(report.blockers.join("\n"), /提示词/);
  assert.match(report.blockers.join("\n"), /500/);
});

// prod 从未 sync 代码提示词，运行期回退 TS 默认（PR 评审）。零条不是事实缺失，
// 但要在报告里如实写 0，不能与「扫过且干净」混为一谈。
test("该环境没有生效提示词：不阻断，报告记 0 个生效版本", async () => {
  const report = await runCheck({
    loadRegistryFn: registryStub,
    source: sourceStub({
      async listActivePrompts() {
        return [];
      },
    }),
  });
  assert.equal(report.status, "pass");
  assert.equal(report.promptsScanned, 0);
  assert.deepEqual(report.blockers, []);
});

test("取文档失败：判失败并指明是哪篇", async () => {
  const report = await runCheck({
    loadRegistryFn: registryStub,
    source: sourceStub({
      async getDocument() {
        throw new SourceError("找不到文档「demo」");
      },
    }),
  });
  assert.equal(report.status, "fail");
  assert.match(report.blockers.join("\n"), /demo/);
});

// 回滚只切分块版本（KbVersionService.switchTo），不还原 knowledge_documents.content。
// 若只看 content，检索在服务旧版分块而校验器照样绿——正是要拦的盲区。
test("索引未跟上：activeVersion 与 version 不一致判失败，不拿未生效的正文比对", async () => {
  const report = await runCheck({
    loadRegistryFn: registryStub,
    source: sourceStub({
      async getDocument(docId) {
        return { docId, content: GOOD_DOC, version: 5, activeVersion: 4 };
      },
    }),
  });
  assert.equal(report.status, "fail");
  assert.equal(report.results.length, 0);
  const text = report.blockers.join("\n");
  assert.match(text, /v5/);
  assert.match(text, /v4/);
  assert.match(text, /索引/);
});

test("索引与当前版本一致：正常比对", async () => {
  const report = await runCheck({ loadRegistryFn: registryStub, source: sourceStub() });
  assert.equal(report.status, "pass");
});
