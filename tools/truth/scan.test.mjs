import assert from "node:assert/strict";
import test from "node:test";

import { parseRegistry } from "./registry.mjs";
import { scanDocument } from "./scan.mjs";

function registryWith(facts, documents = ["demo"]) {
  return parseRegistry({ version: 1, documents, facts, unsourced: [] });
}

function fact(code, row, overrides = {}) {
  return {
    docId: "demo",
    row,
    column: "Fee",
    source: { kind: "payment_channel", code, type: 1, fields: ["fee_rate", "fee_fixed"] },
    expectForm: "flat",
    parser: "channel-row-v1",
    ...overrides,
  };
}

const HEADER = [
  "| Method | Processing Time | Min Amount | Max Amount | Fee |",
  "|:-------|:---------------:|:----------:|:----------:|:---:|",
];

function doc(...rows) {
  return [...HEADER, ...rows].join("\n");
}

test("正常行：解析出标签、单元格与标记", () => {
  const registry = registryWith({ "PH_DEMO.fee": fact("PH_DEMO", "Demo") });
  const result = scanDocument({
    docId: "demo",
    content: doc("| **Demo** | Instant | ₱50 | ₱50,000 | Free <!-- truth: PH_DEMO.fee --> |"),
    registry,
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].label, "Demo");
  assert.equal(result.rows[0].cells.Fee, "Free <!-- truth: PH_DEMO.fee -->".replace(" <!-- truth: PH_DEMO.fee -->", ""));
  assert.deepEqual(result.rows[0].markers, ["PH_DEMO.fee"]);
  assert.equal(result.rows[0].line, 3);
});

test("缺标记：表格行没有 truth 标记即失败", () => {
  const registry = registryWith({ "PH_DEMO.fee": fact("PH_DEMO", "Demo") });
  const result = scanDocument({
    docId: "demo",
    content: doc("| **Demo** | Instant | ₱50 | ₱50,000 | Free <!-- truth: PH_DEMO.fee --> |", "| **Ghost** | Instant | ₱50 | ₱50,000 | Free |"),
    registry,
  });
  const missing = result.errors.filter((error) => error.kind === "missing-marker");
  assert.equal(missing.length, 1);
  assert.equal(missing[0].rowLabel, "Ghost");
  assert.equal(missing[0].line, 4);
});

test("一行多标记：同一行可绑定多个事实", () => {
  const registry = registryWith({
    "PH_DEMO.fee": fact("PH_DEMO", "Demo"),
    "PH_DEMO.min": fact("PH_DEMO", "Demo", { column: "Min Amount" }),
  });
  const result = scanDocument({
    docId: "demo",
    content: doc("| **Demo** | Instant | ₱50 | ₱50,000 | Free <!-- truth: PH_DEMO.fee --> <!-- truth: PH_DEMO.min --> |"),
    registry,
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows[0].markers, ["PH_DEMO.fee", "PH_DEMO.min"]);
});

test("列数不符：单元格数与表头不一致即失败，且该行不产出声明", () => {
  const registry = registryWith({ "PH_DEMO.fee": fact("PH_DEMO", "Demo") });
  const result = scanDocument({
    docId: "demo",
    content: doc("| **Demo** | Instant | ₱50 | Free <!-- truth: PH_DEMO.fee --> |"),
    registry,
  });
  const shape = result.errors.filter((error) => error.kind === "table-shape");
  assert.equal(shape.length, 1);
  assert.match(shape[0].message, /4/);
  assert.equal(result.rows.length, 0);
});

test("标记指向未登记键：失败并报出该键", () => {
  const registry = registryWith({ "PH_DEMO.fee": fact("PH_DEMO", "Demo") });
  const result = scanDocument({
    docId: "demo",
    content: doc("| **Demo** | Instant | ₱50 | ₱50,000 | Free <!-- truth: PH_NOPE.fee --> |"),
    registry,
  });
  const unknown = result.errors.filter((error) => error.kind === "unknown-key");
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].key, "PH_NOPE.fee");
});

test("登记在自己文档、标记写进别篇：失败", () => {
  const registry = registryWith({ "PH_DEMO.fee": fact("PH_DEMO", "Demo") }, ["demo", "other"]);
  const result = scanDocument({
    docId: "other",
    content: doc("| **Demo** | Instant | ₱50 | ₱50,000 | Free <!-- truth: PH_DEMO.fee --> |"),
    registry,
  });
  assert.equal(result.errors.filter((error) => error.kind === "foreign-key").length, 1);
});

test("登记项在文档里完全没有对应的行：失败（含预期行名）", () => {
  const registry = registryWith({
    "PH_DEMO.fee": fact("PH_DEMO", "Demo"),
    "PH_GONE.fee": fact("PH_GONE", "Gone Channel"),
  });
  const result = scanDocument({
    docId: "demo",
    content: doc("| **Demo** | Instant | ₱50 | ₱50,000 | Free <!-- truth: PH_DEMO.fee --> |"),
    registry,
  });
  const missing = result.errors.filter((error) => error.kind === "missing-declaration");
  assert.equal(missing.length, 1);
  assert.equal(missing[0].key, "PH_GONE.fee");
  assert.match(missing[0].message, /Gone Channel/);
});

test("同一键出现在两行：失败", () => {
  const registry = registryWith({ "PH_DEMO.fee": fact("PH_DEMO", "Demo") });
  const result = scanDocument({
    docId: "demo",
    content: doc(
      "| **Demo** | Instant | ₱50 | ₱50,000 | Free <!-- truth: PH_DEMO.fee --> |",
      "| **Demo 2** | Instant | ₱50 | ₱50,000 | Free <!-- truth: PH_DEMO.fee --> |",
    ),
    registry,
  });
  assert.equal(result.errors.filter((error) => error.kind === "duplicate-key").length, 1);
});

test("表格外的标记不算声明，也不报错", () => {
  const registry = registryWith({ "PH_DEMO.fee": fact("PH_DEMO", "Demo") });
  const content = [
    "正文里提到 <!-- truth: PH_DEMO.fee --> 但不在表格中。",
    "",
    ...HEADER,
    "| **Demo** | Instant | ₱50 | ₱50,000 | Free <!-- truth: PH_DEMO.fee --> |",
  ].join("\n");
  const result = scanDocument({ docId: "demo", content, registry });
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 1);
});
