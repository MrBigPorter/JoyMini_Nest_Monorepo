import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { compare } from "./compare.mjs";
import { loadRegistry } from "./registry.mjs";

// 真值取生产 payment_channels：CI 的 truth job 打的就是生产。
// 注意开发库的 PH_GCASH_WITHDRAW 仍是 0.0080，未与本组对齐。
const PROD_CHANNELS = [
  { code: "PH_GCASH", name: "GCash", type: 1, minAmount: "50.00", maxAmount: "50000.00", feeRate: "0.0000", feeFixed: "0.00", status: 1 },
  { code: "PH_PAYMAYA", name: "PayMaya", type: 1, minAmount: "50.00", maxAmount: "50000.00", feeRate: "0.0000", feeFixed: "0.00", status: 1 },
  { code: "PH_BDO", name: "BDO Online", type: 1, minAmount: "100.00", maxAmount: "80000.00", feeRate: "0.0100", feeFixed: "0.00", status: 1 },
  { code: "PH_GCASH_WITHDRAW", name: "GCash Withdraw", type: 2, minAmount: "100.00", maxAmount: "50000.00", feeRate: "0.0100", feeFixed: "5.00", status: 1 },
  { code: "PH_BANK_WITHDRAW", name: "Bank Transfer", type: 2, minAmount: "200.00", maxAmount: "100000.00", feeRate: "0.0100", feeFixed: "10.00", status: 1 },
];

function fixture(docId) {
  return readFileSync(new URL(`./fixtures/docs/${docId}.md`, import.meta.url), "utf8");
}

function allFixtures() {
  return { "deposit-guide": fixture("deposit-guide"), "withdrawal-guide": fixture("withdrawal-guide") };
}

test("修正后的 deposit-guide 必须通过全部登记项", () => {
  const registry = loadRegistry();
  const report = compare({
    registry,
    contents: allFixtures(),
    channels: PROD_CHANNELS,
  });
  assert.deepEqual(report.errors, [], JSON.stringify(report.errors, null, 2));
  assert.ok(report.ok, JSON.stringify(report.results.filter((result) => result.verdict === "fail"), null, 2));
  assert.equal(report.results.filter((result) => result.docId === "deposit-guide").length, 12);
});

test("修正后的 withdrawal-guide 必须通过全部登记项", () => {
  const registry = loadRegistry();
  const report = compare({
    registry,
    contents: allFixtures(),
    channels: PROD_CHANNELS,
  });
  assert.deepEqual(report.errors, [], JSON.stringify(report.errors, null, 2));
  assert.ok(report.ok, JSON.stringify(report.results.filter((result) => result.verdict === "fail"), null, 2));
  assert.equal(report.results.filter((result) => result.docId === "withdrawal-guide").length, 8);
});

test("修正后的文档不再声称配置里不存在的渠道", () => {
  const deposit = fixture("deposit-guide");
  const withdrawal = fixture("withdrawal-guide");
  for (const claim of ["PESONet", "Credit/Debit Card", "Over-the-Counter", "Over the Counter"]) {
    assert.ok(!deposit.includes(claim), `deposit-guide 仍在声称 ${claim}`);
  }
  assert.ok(!withdrawal.includes("PESONet"), "withdrawal-guide 仍在声称 PESONet");
  assert.ok(!/\|\s*\*\*PayMaya \/ Maya\*\*/.test(withdrawal), "withdrawal-guide 仍保留无对应渠道的 PayMaya 行");
});

test("时效只剩定性表述，不再出现精确时长", () => {
  const texts = [fixture("deposit-guide"), fixture("withdrawal-guide")];
  for (const text of texts) {
    for (const precise of ["Instant", "within seconds", "1-3 hours", "1-24 hours"]) {
      assert.ok(!text.includes(precise), `仍出现精确时长「${precise}」`);
    }
  }
});
