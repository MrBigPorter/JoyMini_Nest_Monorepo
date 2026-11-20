import assert from "node:assert/strict";
import test from "node:test";

import { humanize, nextDelayMs, pickPersona } from "./humanize.mjs";

/** 按顺序返回固定值，耗尽后重复最后一个值（便于验证调用顺序）。 */
function sequenceRng(values) {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value;
  };
}

test("delay 在 5–60 秒", () => {
  for (let i = 0; i < 100; i++) {
    const delay = nextDelayMs(Math.random);
    assert.ok(delay >= 5000 && delay <= 60000, String(delay));
    assert.ok(Number.isInteger(delay), String(delay));
  }
});

test("delay 边界与越界 rng 都被钳制在 5–60 秒", () => {
  assert.equal(
    nextDelayMs(() => 0),
    5000,
  );
  assert.equal(
    nextDelayMs(() => 1),
    60000,
  );
});

test("delay 使用注入 rng 保持确定性", () => {
  assert.equal(
    nextDelayMs(() => 0.5),
    nextDelayMs(() => 0.5),
  );
});

test("humanize 不改变空串", () => assert.equal(humanize("", Math.random), ""));

test("humanize 不改变纯空白文本", () => {
  assert.equal(
    humanize("   ", () => 0),
    "   ",
  );
});

test("humanize 用注入 rng 追加语气词", () => {
  assert.equal(
    humanize("帮我查订单", () => 0),
    "帮我查订单呢",
  );
});

test("humanize 把语气词放在句末标点前", () => {
  assert.equal(
    humanize("这个要多久？", () => 0),
    "这个要多久呢？",
  );
});

test("humanize 的“谢谢”作为独立短句追加", () => {
  assert.equal(humanize("好的。", sequenceRng([0, 0.9])), "好的。谢谢");
  assert.equal(humanize("好的", sequenceRng([0, 0.9])), "好的，谢谢");
});

test("humanize 大部分情况保持原文", () => {
  assert.equal(
    humanize("我的订单", () => 0.99),
    "我的订单",
  );
});

test("humanize 偶尔把“的”替换成“得”", () => {
  assert.equal(humanize("我的订单", sequenceRng([0.5, 0, 0])), "我得订单");
});

test("humanize 不会为了噪声制造乱码", () => {
  assert.equal(humanize("你好", sequenceRng([0.5, 0, 0])), "你好");
});

test("humanize 支持英文语气词", () => {
  assert.equal(
    humanize("can you check my order", () => 0, { language: "en" }),
    "can you check my order please",
  );
  assert.equal(
    humanize("can you check my order?", () => 0, { language: "en" }),
    "can you check my order please?",
  );
});

test("humanize 拒绝非字符串与未知 language", () => {
  assert.throws(() => humanize(null, Math.random), /string/);
  assert.throws(
    () => humanize("hi", () => 0.9, { language: "fr" }),
    /language/,
  );
});

test("humanize 使用注入 rng 保持确定性", () => {
  assert.equal(
    humanize("我的订单", () => 0),
    humanize("我的订单", () => 0),
  );
  assert.deepEqual(
    [humanize("帮我查一下", sequenceRng([0, 0]))],
    [humanize("帮我查一下", sequenceRng([0, 0]))],
  );
});

test("pickPersona 只返回合法语言与风格，且两类值都覆盖", () => {
  const languages = new Set();
  const styles = new Set();
  let seed = 0;
  const rng = () => {
    seed = (seed + 0.137) % 1;
    return seed;
  };

  for (let i = 0; i < 200; i++) {
    const persona = pickPersona(rng);
    assert.ok(["zh", "en"].includes(persona.language), persona.language);
    assert.ok(
      ["short", "normal", "impatient"].includes(persona.style),
      persona.style,
    );
    languages.add(persona.language);
    styles.add(persona.style);
  }

  assert.deepEqual([...languages].sort(), ["en", "zh"]);
  assert.deepEqual([...styles].sort(), ["impatient", "normal", "short"]);
});

test("pickPersona 边界由 rng 决定", () => {
  assert.deepEqual(
    pickPersona(() => 0),
    { language: "zh", style: "short" },
  );
  assert.deepEqual(
    pickPersona(() => 1),
    {
      language: "en",
      style: "impatient",
    },
  );
});
