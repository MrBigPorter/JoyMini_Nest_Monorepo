import assert from "node:assert/strict";
import test from "node:test";

import { CellParseError, parseCell } from "./cell.mjs";

test("amount：₱1,000 解析为 1000", () => {
  assert.deepEqual(parseCell("₱1,000", "amount"), { form: "amount", amount: 1000, raw: "₱1,000" });
});

test("amount：₱50,000 解析为 50000", () => {
  assert.equal(parseCell("₱50,000", "amount").amount, 50000);
});

test("flat：Free 解析为 0", () => {
  assert.deepEqual(parseCell("Free", "flat"), { form: "flat", fixed: 0, raw: "Free" });
});

test("flat：₱15 解析为 15", () => {
  assert.deepEqual(parseCell("₱15", "flat"), { form: "flat", fixed: 15, raw: "₱15" });
});

test("flat：₱10 fee 解析为 10", () => {
  assert.equal(parseCell("₱10 fee", "flat").fixed, 10);
});

test("rate_plus_fixed：0.8% + ₱5 解析为 0.008 / 5", () => {
  assert.deepEqual(parseCell("0.8% + ₱5", "rate_plus_fixed"), {
    form: "rate_plus_fixed",
    rate: 0.008,
    fixed: 5,
    raw: "0.8% + ₱5",
  });
});

test("rate_plus_fixed：只写比例时 fixed 为 null，交由比对器判断", () => {
  assert.deepEqual(parseCell("0.8%", "rate_plus_fixed"), {
    form: "rate",
    rate: 0.008,
    fixed: null,
    raw: "0.8%",
  });
});

test("rate_plus_fixed：2.5% fee 是比例而非 flat", () => {
  assert.deepEqual(parseCell("2.5% fee", "rate_plus_fixed"), {
    form: "rate",
    rate: 0.025,
    fixed: null,
    raw: "2.5% fee",
  });
});

test("形式不符：rate_plus_fixed 登记下写 ₱15 报错", () => {
  assert.throws(() => parseCell("₱15", "rate_plus_fixed"), CellParseError);
});

test("形式不符：flat 登记下写 0.8% + ₱5 报错", () => {
  assert.throws(() => parseCell("0.8% + ₱5", "flat"), CellParseError);
});

test("形式不符：amount 登记下写 Free 报错", () => {
  assert.throws(() => parseCell("Free", "amount"), CellParseError);
});

test("非法文本：amount 登记下写 Instant 报错，且消息带原文", () => {
  assert.throws(() => parseCell("Instant", "amount"), (error) => {
    assert.ok(error instanceof CellParseError);
    assert.match(error.message, /Instant/);
    return true;
  });
});

test("非法文本：空单元格报错", () => {
  assert.throws(() => parseCell("   ", "flat"), CellParseError);
});

test("未知 expectForm 报错", () => {
  assert.throws(() => parseCell("Free", "percent"), /percent/);
});
