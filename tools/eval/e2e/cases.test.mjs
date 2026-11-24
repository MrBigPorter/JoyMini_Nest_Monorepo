import assert from "node:assert/strict";
import test from "node:test";

import {
  buildActionCases,
  buildBoundaryCases,
  buildKnowledgeCases,
  buildReadCases,
  loadGoldens,
  pairMultiTurn,
  parseGoldenLines,
  renderSlots,
  selectCasesForDocIds,
  splitGoldens,
} from "./cases.mjs";
import { ADDRESS_LABELS } from "./fixtures.mjs";

const SLOTS = Object.freeze({
  city: "宿务",
  amount: "200",
  product: "蓝牙耳机",
  code: "WELCOME2026",
  orderId: "ORD-1",
  redeemCode: "WELCOME2026",
  withdrawAmount: "200",
  withdrawAccount: "09171234567",
  withdrawAccountName: "Maria Santos",
  createAddressCity: "宿务",
  createAddressFull: "Cebu City, Lahug, JY Square Mall 3F Unit 302",
  createAddressCityMatch: "Cebu",
  deleteAddressCity: "碧瑶",
});

test("parseGoldenLines：跳过空行，坏 JSON 与缺字段都要报错", () => {
  const rows = parseGoldenLines(
    '{"id":"a","query":"q","expectedDocIds":["d"],"lang":"zh"}\n\n{"id":"b","query":"q2"}',
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].expectedDocIds, ["d"]);
  assert.deepEqual(rows[1].expectedDocIds, []);

  assert.throws(() => parseGoldenLines("{not json}"), /不是合法 JSON/);
  assert.throws(() => parseGoldenLines('{"id":"x"}'), /缺少 id\/query/);
});

test("题库：195 条，正 163 / 负 32（负样本含注入句）", () => {
  const items = loadGoldens();
  const { positive, negative } = splitGoldens(items);
  assert.equal(items.length, 195);
  assert.equal(positive.length, 163);
  assert.equal(negative.length, 32);
  assert.ok(negative.some((item) => /忽略|ignore/i.test(item.query)));
});

test("buildKnowledgeCases：原文直发、limit 生效、负样本单独分类", () => {
  const items = loadGoldens();
  const all = buildKnowledgeCases(items);
  assert.equal(all.length, items.length);
  assert.equal(all[0].question, items[0].query);
  assert.equal(all[0].turns[0], items[0].query);

  const limited = buildKnowledgeCases(items, { limit: 3 });
  assert.equal(limited.length, 3);

  const negative = all.filter((item) => item.kind === "negative");
  assert.equal(negative.length, 32);
  assert.ok(negative.every((item) => item.expectedDocIds.length === 0));
});

test("pairMultiTurn：确定性配对、两轮都是既有题、不重复使用", () => {
  const { positive } = splitGoldens(loadGoldens());
  const first = pairMultiTurn(positive, { maxPairs: 20 });
  const second = pairMultiTurn(positive, { maxPairs: 20 });
  assert.equal(first.length, 20);
  assert.deepEqual(
    first.map((item) => item.id),
    second.map((item) => item.id),
  );
  const used = new Set();
  for (const pair of first) {
    assert.equal(pair.turns.length, 2);
    for (const turn of pair.turns) {
      assert.equal(typeof turn, "string");
      assert.ok(turn.length > 0);
    }
    for (const id of pair.id.replace("multi:", "").split("+")) {
      assert.ok(!used.has(id), `重复配对 ${id}`);
      used.add(id);
    }
  }
});

test("renderSlots：缺槽位直接报错，不把占位符发出去", () => {
  assert.equal(renderSlots("我在{city}", { city: "宿务" }), "我在宿务");
  assert.throws(() => renderSlots("我在{city}", {}), /缺少槽位 city/);
});

test("buildActionCases：7 个写动作，槽位齐全时全部可执行", () => {
  const cases = buildActionCases(SLOTS);
  assert.equal(cases.length, 7);
  assert.deepEqual(
    cases.map((item) => item.action),
    [
      "claim_coupon",
      "redeem_code",
      "draw",
      "create_address",
      "update_address",
      "delete_address",
      "withdraw",
    ],
  );
  for (const testCase of cases) {
    assert.ok(Array.isArray(testCase.turns) && testCase.turns.length > 0, testCase.id);
    assert.equal(testCase.skipReason, null, testCase.id);
    assert.equal(testCase.expectConfirm, true, testCase.id);
  }

  const update = cases.find((item) => item.action === "update_address");
  assert.deepEqual(update.turns, ["把我在马尼拉的收货地址改成宿务"]);
  assert.equal(update.manualQuestion, true);
  assert.equal(update.verify.label, ADDRESS_LABELS.manila);

  const withdraw = cases.find((item) => item.action === "withdraw");
  assert.equal(withdraw.needsOtp, true);
  assert.match(withdraw.turns.at(-1), /09171234567/);

  const claim = cases.find((item) => item.action === "claim_coupon");
  assert.equal(claim.verify.name, "Big Spender");

  // 删除必须指向账号里真实存在的地址（fixture 建在「碧瑶」）
  const del = cases.find((item) => item.action === "delete_address");
  assert.match(del.turns[0], /碧瑶/);
});

test("buildActionCases：槽位缺失时相关动作标 skip，而不是发占位符", () => {
  const cases = buildActionCases({});
  const byAction = Object.fromEntries(cases.map((item) => [item.action, item]));
  assert.match(byAction.redeem_code.skipReason, /缺少槽位 code/);
  assert.ok(byAction.create_address.skipReason || byAction.create_address.turns === null);
  assert.match(byAction.withdraw.skipReason, /缺少槽位 amount/);
  // 唯一的人工题不依赖槽位
  assert.equal(byAction.update_address.skipReason ?? null, null);
  assert.equal(byAction.update_address.turns.length, 1);
});

test("buildReadCases：12 个读类；缺 orderId 的用例显式 skip", () => {
  const complete = buildReadCases(SLOTS);
  assert.equal(complete.length, 12);
  for (const testCase of complete) {
    assert.ok(Array.isArray(testCase.turns), testCase.id);
    assert.equal(testCase.skipReason, null, testCase.id);
  }

  const partial = buildReadCases({ city: "宿务", product: "蓝牙耳机" });
  const order = partial.find((item) => item.id === "read:order_status");
  assert.match(order.skipReason, /缺少槽位 orderId/);
  const balance = partial.find((item) => item.id === "read:wallet_balance");
  assert.equal(balance.skipReason, null);
});

test("buildBoundaryCases：6 个边界场景；长会话依赖 orderId", () => {
  const complete = buildBoundaryCases(SLOTS);
  assert.equal(complete.length, 6);
  assert.ok(complete.every((item) => item.skipReason === null));

  const partial = buildBoundaryCases({});
  const longSession = partial.find((item) => item.id === "boundary:long_session");
  assert.match(longSession.skipReason, /orderId/);
  const injection = partial.find((item) => item.id === "boundary:injection");
  assert.equal(injection.skipReason, null);
});

test("selectCasesForDocIds：知识题取交集、多轮取并集交集", () => {
  const cases = [
    { id: "knowledge:a", kind: "knowledge", expectedDocIds: ["doc-a"] },
    { id: "knowledge:b", kind: "knowledge", expectedDocIds: ["doc-b"] },
    { id: "knowledge:ab", kind: "knowledge", expectedDocIds: ["doc-a", "doc-b"] },
    { id: "multi:a+c", kind: "multi", expectedDocIds: ["doc-a", "doc-c"] },
    { id: "action:x", kind: "action", expectedDocIds: [] },
  ];
  const selected = selectCasesForDocIds(cases, ["doc-a"]);
  assert.deepEqual(
    selected.map((item) => item.id),
    ["knowledge:a", "knowledge:ab", "multi:a+c"],
  );
});

test("selectCasesForDocIds：负样本默认排除，显式打开才纳入", () => {
  const cases = [
    { id: "knowledge:a", kind: "knowledge", expectedDocIds: ["doc-a"] },
    { id: "knowledge:neg", kind: "negative", expectedDocIds: [] },
  ];
  assert.deepEqual(
    selectCasesForDocIds(cases, ["doc-a"]).map((item) => item.id),
    ["knowledge:a"],
  );
  assert.deepEqual(
    selectCasesForDocIds(cases, ["doc-a"], { includeNegatives: true }).map(
      (item) => item.id,
    ),
    ["knowledge:a", "knowledge:neg"],
  );
});

test("selectCasesForDocIds：被删除文档的用例必须纳入", () => {
  const cases = [
    { id: "knowledge:deleted", kind: "knowledge", expectedDocIds: ["doc-gone"] },
    { id: "knowledge:other", kind: "knowledge", expectedDocIds: ["doc-other"] },
  ];
  assert.deepEqual(
    selectCasesForDocIds(cases, [], { deletedDocIds: ["doc-gone"] }).map(
      (item) => item.id,
    ),
    ["knowledge:deleted"],
  );
});

test("selectCasesForDocIds：空映射不猜测、不返回无关用例", () => {
  const cases = [
    { id: "knowledge:a", kind: "knowledge", expectedDocIds: ["doc-a"] },
    { id: "knowledge:neg", kind: "negative", expectedDocIds: [] },
  ];
  assert.deepEqual(selectCasesForDocIds(cases, []), []);
  assert.deepEqual(
    selectCasesForDocIds(cases, [], { includeNegatives: true }),
    [],
  );
});
