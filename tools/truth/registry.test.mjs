import assert from "node:assert/strict";
import test from "node:test";

import { EXPECT_FORMS, RegistryError, loadRegistry, parseRegistry } from "./registry.mjs";

function minimalRegistry(overrides = {}) {
  return {
    version: 1,
    documents: ["demo-doc"],
    facts: {
      "PH_DEMO.fee": {
        docId: "demo-doc",
        row: "Demo",
        source: { kind: "payment_channel", code: "PH_DEMO", type: 1, fields: ["fee_rate", "fee_fixed"] },
        expectForm: "flat",
        parser: "channel-row-v1",
      },
    },
    unsourced: [],
    ...overrides,
  };
}

test("真实登记文件可加载，覆盖 5 个渠道各 4 类事实", () => {
  const registry = loadRegistry();
  assert.equal(registry.version, 1);
  assert.deepEqual(registry.documents, ["deposit-guide", "withdrawal-guide"]);
  const keys = Object.keys(registry.facts).sort();
  assert.equal(keys.length, 20);
  for (const channel of [
    "PH_GCASH",
    "PH_PAYMAYA",
    "PH_BDO",
    "PH_GCASH_WITHDRAW",
    "PH_BANK_WITHDRAW",
  ]) {
    for (const facet of ["available", "fee", "min", "max"]) {
      assert.ok(keys.includes(`${channel}.${facet}`), `缺少登记项 ${channel}.${facet}`);
    }
  }
});

test("每条登记都带 docId / row / source / expectForm / parser 且非空", () => {
  const registry = loadRegistry();
  for (const [key, fact] of Object.entries(registry.facts)) {
    assert.equal(typeof fact.docId, "string", `${key} 缺 docId`);
    assert.ok(fact.docId.length > 0, `${key} docId 为空`);
    assert.equal(typeof fact.row, "string", `${key} 缺 row`);
    assert.ok(fact.row.length > 0, `${key} row 为空`);
    assert.equal(fact.source?.kind, "payment_channel", `${key} source.kind 不对`);
    assert.ok(fact.source.code?.length > 0, `${key} source.code 为空`);
    assert.ok([1, 2].includes(fact.source.type), `${key} source.type 必须是 1 或 2`);
    assert.ok(Array.isArray(fact.source.fields) && fact.source.fields.length > 0, `${key} source.fields 为空`);
    assert.ok(EXPECT_FORMS.includes(fact.expectForm), `${key} expectForm 非法：${fact.expectForm}`);
    assert.equal(fact.parser, "channel-row-v1", `${key} parser 不对`);
  }
});

test("时效登记为 unsourced 且带 reason", () => {
  const registry = loadRegistry();
  const item = registry.unsourced.find((entry) => entry.type === "processing_time");
  assert.ok(item, "缺少 processing_time 的 unsourced 条目");
  assert.ok(item.reason.length > 0, "unsourced 条目缺 reason");
  assert.ok(Array.isArray(item.documents) && item.documents.length > 0, "unsourced 条目缺 documents");
});

test("缺字段的登记被拒绝", () => {
  const raw = minimalRegistry();
  delete raw.facts["PH_DEMO.fee"].parser;
  assert.throws(() => parseRegistry(raw), (error) => {
    assert.ok(error instanceof RegistryError);
    assert.match(error.message, /parser/);
    return true;
  });
});

test("未知 expectForm 被拒绝", () => {
  const raw = minimalRegistry();
  raw.facts["PH_DEMO.fee"].expectForm = "percent";
  assert.throws(() => parseRegistry(raw), /expectForm/);
});

test("unsourced 条目缺 reason 被拒绝", () => {
  const raw = minimalRegistry({ unsourced: [{ type: "processing_time", documents: ["demo-doc"] }] });
  assert.throws(() => parseRegistry(raw), /reason/);
});

test("文件不存在时抛出可读错误", () => {
  assert.throws(() => loadRegistry(new URL("./no-such-registry.json", import.meta.url)), RegistryError);
});
