import assert from "node:assert/strict";
import test from "node:test";

import { compare } from "./compare.mjs";
import { parseRegistry } from "./registry.mjs";

const HEADER = [
  "| Method | Processing Time | Min Amount | Max Amount | Fee |",
  "|:-------|:---------------:|:----------:|:----------:|:---:|",
];

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

function channel(overrides = {}) {
  return {
    code: "PH_DEMO",
    name: "Demo",
    type: 1,
    minAmount: "50.00",
    maxAmount: "50000.00",
    feeRate: "0.0000",
    feeFixed: "0.00",
    status: 1,
    ...overrides,
  };
}

function registryWith(facts) {
  return parseRegistry({ version: 1, documents: ["demo"], facts, unsourced: [] });
}

function doc(...rows) {
  return [...HEADER, ...rows].join("\n");
}

test("全部一致：每条声明通过，整体结论为通过", () => {
  const registry = registryWith({
    "PH_DEMO.fee": fact("PH_DEMO", "Demo"),
    "PH_DEMO.min": fact("PH_DEMO", "Demo", { column: "Min Amount", expectForm: "amount", source: { kind: "payment_channel", code: "PH_DEMO", type: 1, fields: ["min_amount"] } }),
  });
  const content = doc("| **Demo** | Instant | ₱50 | ₱50,000 | Free <!-- truth: PH_DEMO.fee --> <!-- truth: PH_DEMO.min --> |");
  const report = compare({ registry, contents: { demo: content }, channels: [channel()] });

  assert.deepEqual(report.errors, []);
  assert.equal(report.results.length, 2);
  assert.ok(report.results.every((result) => result.verdict === "pass"));
  assert.equal(report.ok, true);
  const fee = report.results.find((result) => result.facet === "fee");
  assert.equal(fee.docId, "demo");
  assert.equal(fee.declared, "Free");
  assert.equal(fee.truth, "₱0");
});

test("值不一致：₱100 对最低额 ₱200，判失败并带两端值", () => {
  const registry = registryWith({
    "PH_DEMO.min": fact("PH_DEMO", "Demo", {
      column: "Min Amount",
      expectForm: "amount",
      source: { kind: "payment_channel", code: "PH_DEMO", type: 1, fields: ["min_amount"] },
    }),
  });
  const content = doc("| **Demo** | Instant | ₱100 | ₱50,000 | Free <!-- truth: PH_DEMO.min --> |");
  const report = compare({
    registry,
    contents: { demo: content },
    channels: [channel({ minAmount: "200.00" })],
  });

  const result = report.results.find((entry) => entry.facet === "min");
  assert.equal(result.verdict, "fail");
  assert.equal(result.reason, "value-mismatch");
  assert.equal(result.declared, "₱100");
  assert.equal(result.truth, "₱200");
  assert.equal(report.ok, false);
});

test("形式不一致：登记比例 + 固定，文档写固定 ₱15", () => {
  const registry = registryWith({
    "PH_DEMO.fee": fact("PH_DEMO", "Demo", { expectForm: "rate_plus_fixed" }),
  });
  const content = doc("| **Demo** | Instant | ₱50 | ₱50,000 | ₱15 <!-- truth: PH_DEMO.fee --> |");
  const report = compare({
    registry,
    contents: { demo: content },
    channels: [channel({ feeRate: "0.0080", feeFixed: "5.00" })],
  });

  const result = report.results.find((entry) => entry.facet === "fee");
  assert.equal(result.verdict, "fail");
  assert.equal(result.reason, "form-mismatch");
  assert.equal(result.declared, "₱15");
  assert.equal(result.truth, "0.8% + ₱5");
});

test("比例 + 固定：文档写 0.8% + ₱5 且真值一致，通过", () => {
  const registry = registryWith({
    "PH_DEMO.fee": fact("PH_DEMO", "Demo", { expectForm: "rate_plus_fixed" }),
  });
  const content = doc("| **Demo** | Instant | ₱50 | ₱50,000 | 0.8% + ₱5 <!-- truth: PH_DEMO.fee --> |");
  const report = compare({
    registry,
    contents: { demo: content },
    channels: [channel({ feeRate: "0.0080", feeFixed: "5.00" })],
  });
  assert.equal(report.results[0].verdict, "pass");
});

test("比例 + 固定：文档只写比例、真值固定费为 0 时通过", () => {
  const registry = registryWith({
    "PH_DEMO.fee": fact("PH_DEMO", "Demo", { expectForm: "rate_plus_fixed" }),
  });
  const content = doc("| **Demo** | Instant | ₱50 | ₱50,000 | 1% <!-- truth: PH_DEMO.fee --> |");
  const report = compare({
    registry,
    contents: { demo: content },
    channels: [channel({ feeRate: "0.0100", feeFixed: "0.00" })],
  });
  assert.equal(report.results[0].verdict, "pass");
});

test("比例 + 固定：文档只写比例、真值有固定费时判失败（不能漏掉固定费）", () => {
  const registry = registryWith({
    "PH_DEMO.fee": fact("PH_DEMO", "Demo", { expectForm: "rate_plus_fixed" }),
  });
  const content = doc("| **Demo** | Instant | ₱50 | ₱50,000 | 0.8% <!-- truth: PH_DEMO.fee --> |");
  const report = compare({
    registry,
    contents: { demo: content },
    channels: [channel({ feeRate: "0.0080", feeFixed: "5.00" })],
  });
  assert.equal(report.results[0].verdict, "fail");
  assert.equal(report.results[0].reason, "form-mismatch");
});

test("渠道不存在：登记了文档也写了，但配置里没有该渠道", () => {
  const registry = registryWith({
    "PH_GONE.available": fact("PH_GONE", "Gone", {
      column: null,
      expectForm: "boolean",
      source: { kind: "payment_channel", code: "PH_GONE", type: 1, fields: ["status"] },
    }),
  });
  const content = doc("| **Gone** | Instant | ₱50 | ₱5,000 | Free <!-- truth: PH_GONE.available --> |");
  const report = compare({ registry, contents: { demo: content }, channels: [channel()] });

  const result = report.results.find((entry) => entry.facet === "available");
  assert.equal(result.verdict, "fail");
  assert.equal(result.reason, "channel-missing");
  assert.match(result.declared, /Gone/);
  assert.equal(result.truth, "配置中不存在");
});

test("渠道已停用：文档仍声称支持", () => {
  const registry = registryWith({
    "PH_DEMO.available": fact("PH_DEMO", "Demo", {
      column: null,
      expectForm: "boolean",
      source: { kind: "payment_channel", code: "PH_DEMO", type: 1, fields: ["status"] },
    }),
  });
  const content = doc("| **Demo** | Instant | ₱50 | ₱5,000 | Free <!-- truth: PH_DEMO.available --> |");
  const report = compare({ registry, contents: { demo: content }, channels: [channel({ status: 0 })] });

  const result = report.results.find((entry) => entry.facet === "available");
  assert.equal(result.verdict, "fail");
  assert.equal(result.reason, "channel-disabled");
});

test("单元格不可解析：连同原文记失败", () => {
  const registry = registryWith({
    "PH_DEMO.min": fact("PH_DEMO", "Demo", {
      column: "Min Amount",
      expectForm: "amount",
      source: { kind: "payment_channel", code: "PH_DEMO", type: 1, fields: ["min_amount"] },
    }),
  });
  const content = doc("| **Demo** | Instant | varies | ₱5,000 | Free <!-- truth: PH_DEMO.min --> |");
  const report = compare({ registry, contents: { demo: content }, channels: [channel()] });

  const result = report.results.find((entry) => entry.facet === "min");
  assert.equal(result.verdict, "fail");
  assert.equal(result.reason, "unparseable");
  assert.equal(result.declared, "varies");
});

test("登记项在文档里没有行：通过扫描错误报出，比对结果里不含该项", () => {
  const registry = registryWith({
    "PH_DEMO.fee": fact("PH_DEMO", "Demo"),
    "PH_GONE.fee": fact("PH_GONE", "Gone"),
  });
  const content = doc("| **Demo** | Instant | ₱50 | ₱50,000 | Free <!-- truth: PH_DEMO.fee --> |");
  const report = compare({
    registry,
    contents: { demo: content },
    channels: [channel(), channel({ code: "PH_GONE", name: "Gone" })],
  });
  assert.equal(report.results.length, 1);
  assert.ok(report.errors.some((error) => error.kind === "missing-declaration" && error.key === "PH_GONE.fee"));
  assert.equal(report.ok, false);
});

test("两篇文档分别比对，结果带各自 docId", () => {
  const registry = parseRegistry({
    version: 1,
    documents: ["demo", "other"],
    facts: {
      "PH_DEMO.fee": fact("PH_DEMO", "Demo"),
      "PH_OTHER.fee": fact("PH_OTHER", "Other", { docId: "other" }),
    },
    unsourced: [],
  });
  const report = compare({
    registry,
    contents: {
      demo: doc("| **Demo** | Instant | ₱50 | ₱50,000 | Free <!-- truth: PH_DEMO.fee --> |"),
      other: doc("| **Other** | Instant | ₱50 | ₱50,000 | ₱10 <!-- truth: PH_OTHER.fee --> |"),
    },
    channels: [channel(), channel({ code: "PH_OTHER", name: "Other", feeFixed: "10.00" })],
  });
  assert.equal(report.ok, true);
  assert.deepEqual(
    report.results.map((result) => result.docId).sort(),
    ["demo", "other"],
  );
});
