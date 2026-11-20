import assert from "node:assert/strict";
import test from "node:test";

import {
  SCENARIOS,
  coverageOf,
  pickScenario,
  renderTurns,
  resetScenarioPicker,
} from "./scenarios.mjs";

const INTENTS = [
  "order",
  "wallet",
  "coupon",
  "product",
  "user",
  "kyc",
  "lucky-draw",
  "rag",
  "general",
];

test("场景覆盖 9 个 intent + 特殊场景", () => {
  const intents = new Set(SCENARIOS.map((s) => s.intent));
  for (const i of INTENTS) {
    assert.ok(intents.has(i), i);
  }
  assert.ok(SCENARIOS.some((s) => s.expectTransfer));
  assert.ok(SCENARIOS.some((s) => s.expectConfirm));
  assert.ok(SCENARIOS.some((s) => s.special === "injection"));
});

test("每个 intent 至少 3 个场景", () => {
  const counts = {};
  for (const scenario of SCENARIOS) {
    counts[scenario.intent] = (counts[scenario.intent] ?? 0) + 1;
  }
  for (const intent of INTENTS) {
    assert.ok(
      (counts[intent] ?? 0) >= 3,
      `${intent} 只有 ${counts[intent] ?? 0} 个场景`,
    );
  }
});

test("特殊场景覆盖 transfer / correction / injection / ambiguous", () => {
  const specials = new Set(
    SCENARIOS.map((s) => s.special).filter((value) => value !== undefined),
  );
  for (const special of ["transfer", "correction", "injection", "ambiguous"]) {
    assert.ok(specials.has(special), special);
  }
});

test("场景 id 唯一、turns 非空且不含未定义的确认指令", () => {
  const ids = new Set();
  for (const scenario of SCENARIOS) {
    assert.match(scenario.id, /^[a-z0-9_]+$/, scenario.id);
    assert.ok(!ids.has(scenario.id), `重复 id ${scenario.id}`);
    ids.add(scenario.id);
    assert.ok(Array.isArray(scenario.turns), scenario.id);
    assert.ok(scenario.turns.length > 0, scenario.id);
    for (const turn of scenario.turns) {
      assert.equal(typeof turn, "string", scenario.id);
      assert.ok(turn.trim().length > 0, scenario.id);
      // 确认类场景只到卡片，不能自己发确认指令
      assert.ok(
        !/确认(支付|提现|领取|充值|下单|删除)|执行确认/i.test(turn),
        `${scenario.id}: ${turn}`,
      );
    }
  }
});

test("确认类场景必须只有一轮（只触发确认卡片）", () => {
  for (const scenario of SCENARIOS.filter((s) => s.expectConfirm)) {
    assert.equal(scenario.turns.length, 1, scenario.id);
  }
});

test("renderTurns 替换槽位且不残留花括号", () => {
  const scenario = {
    id: "render_demo",
    intent: "order",
    turns: [
      "帮我查订单 {orderId}",
      "我在{city}，金额 {amount}，商品 {product}，兑换码 {code}",
    ],
  };
  const turns = renderTurns(scenario, () => 0);

  assert.equal(turns.length, 2);
  for (const turn of turns) {
    assert.ok(!/[{}]/.test(turn), turn);
  }
  assert.match(turns[0], /ORD/);
});

test("所有内置场景都能渲染且无残留槽位", () => {
  for (const scenario of SCENARIOS) {
    for (const turn of renderTurns(scenario, () => 0)) {
      assert.ok(!/[{}]/.test(turn), `${scenario.id}: ${turn}`);
    }
  }
});

test("renderTurns 使用注入的 rng 保持确定性", () => {
  const scenario = {
    id: "deterministic",
    intent: "wallet",
    turns: ["我想充值 {amount}"],
  };
  assert.deepEqual(
    renderTurns(scenario, () => 0),
    renderTurns(scenario, () => 0),
  );
});

test("coverageOf 统计 intent 并为所有 intent 预置 0", () => {
  const used = SCENARIOS.filter((s) => s.intent === "order").slice(0, 2);
  const coverage = coverageOf(used);

  assert.equal(coverage.order, 2);
  for (const intent of INTENTS) {
    assert.equal(typeof coverage[intent], "number", intent);
    if (intent !== "order") assert.equal(coverage[intent], 0, intent);
  }
});

test("pickScenario 排除指定 intent 且不连续重复", () => {
  resetScenarioPicker();
  const excluded = ["order", "wallet"];
  let previous = pickScenario({ excludeIntents: excluded, rng: () => 0 });
  assert.ok(!excluded.includes(previous.intent), previous.intent);

  for (let i = 0; i < 20; i += 1) {
    const next = pickScenario({ excludeIntents: excluded, rng: () => 0 });
    assert.ok(!excluded.includes(next.intent), next.intent);
    assert.notEqual(next.id, previous.id);
    previous = next;
  }
});

test("pickScenario 排除全部 intent 时报错", () => {
  assert.throws(
    () => pickScenario({ excludeIntents: INTENTS }),
    /excludeIntents|没有可用/,
  );
});
