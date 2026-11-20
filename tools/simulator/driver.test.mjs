import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBusinessUrl,
  buildSendMessagePayload,
  classifyEvent,
  normalizeDispatch,
  parseArgs,
} from "./driver.mjs";

const config = {
  apiBaseUrl: "https://api.joyminis.com/api",
  businessId: "simulation_support_v1",
};

test("buildBusinessUrl 拼接渠道查询参数", () => {
  assert.equal(
    buildBusinessUrl(config),
    "https://api.joyminis.com/api/v1/chat/business?businessId=simulation_support_v1",
  );
  assert.equal(
    buildBusinessUrl(config, "sim test&x"),
    "https://api.joyminis.com/api/v1/chat/business?businessId=sim%20test%26x",
  );
  assert.equal(
    buildBusinessUrl(
      { ...config, trafficSource: "simulation_support_v1" },
      "official_platform_support_v1",
    ),
    "https://api.joyminis.com/api/v1/chat/business?businessId=official_platform_support_v1&trafficSource=simulation_support_v1",
  );
  assert.throws(() => buildBusinessUrl(config, "  "), /businessId/);
});

test("buildSendMessagePayload 生成 type=0 的上行载荷", () => {
  assert.deepEqual(
    buildSendMessagePayload("conv-1", "你好", { tempId: "temp-1" }),
    {
      conversationId: "conv-1",
      content: "你好",
      type: 0,
      tempId: "temp-1",
    },
  );
});

test("buildSendMessagePayload 拒绝空会话 / 空内容 / 空 tempId", () => {
  assert.throws(
    () => buildSendMessagePayload("", "x", { tempId: "t" }),
    /conversationId/,
  );
  assert.throws(
    () => buildSendMessagePayload("conv-1", "   ", { tempId: "t" }),
    /content/,
  );
  assert.throws(
    () => buildSendMessagePayload("conv-1", "x", { tempId: "" }),
    /tempId/,
  );
});

test("normalizeDispatch 拆开 dispatch 信封，兼容直发事件", () => {
  assert.deepEqual(
    normalizeDispatch("dispatch", {
      type: "chat_message",
      data: { id: "m1" },
    }),
    { type: "chat_message", data: { id: "m1" } },
  );
  assert.deepEqual(
    normalizeDispatch("ai_confirm", { conversationId: "conv-1" }),
    { type: "ai_confirm", data: { conversationId: "conv-1" } },
  );
  assert.deepEqual(normalizeDispatch("dispatch", null), {
    type: "dispatch",
    data: null,
  });
});

test("classifyEvent 只把 isAi=true 的会话消息当作 AI 回复", () => {
  const event = normalizeDispatch("dispatch", {
    type: "chat_message",
    data: { conversationId: "conv-1", isAi: true, content: "好的" },
  });
  assert.equal(classifyEvent(event, "conv-1"), "reply");

  const userMessage = normalizeDispatch("dispatch", {
    type: "chat_message",
    data: { conversationId: "conv-1", senderId: "user-1", content: "你好" },
  });
  assert.equal(classifyEvent(userMessage, "conv-1"), null);

  const otherConversation = normalizeDispatch("dispatch", {
    type: "chat_message",
    data: { conversationId: "conv-2", isAi: true },
  });
  assert.equal(classifyEvent(otherConversation, "conv-1"), null);
});

test("classifyEvent 兼容旧后端的 senderId === botUserId", () => {
  const event = normalizeDispatch("dispatch", {
    type: "chat_message",
    data: { conversationId: "conv-1", senderId: "bot-1" },
  });
  // 没有 botUserId 时不把普通消息误判为 AI 回复。
  assert.equal(classifyEvent(event, "conv-1"), null);
  assert.equal(classifyEvent(event, "conv-1", { botUserId: "bot-1" }), "reply");
  assert.equal(classifyEvent(event, "conv-1", { botUserId: "bot-2" }), null);
});

test("classifyEvent 对任何场景都识别 ai_confirm / ai_transfer", () => {
  const confirm = normalizeDispatch("dispatch", {
    type: "ai_confirm",
    data: { conversationId: "conv-1", action: "withdraw" },
  });
  assert.equal(classifyEvent(confirm, "conv-1"), "confirm");

  const transfer = normalizeDispatch("dispatch", {
    type: "ai_transfer",
    data: { conversationId: "conv-1", reason: "user_request" },
  });
  assert.equal(classifyEvent(transfer, "conv-1"), "transfer");

  const other = normalizeDispatch("dispatch", {
    type: "ai_confirm",
    data: { conversationId: "conv-2" },
  });
  assert.equal(classifyEvent(other, "conv-1"), null);

  assert.equal(
    classifyEvent({ type: "wallet_change", data: {} }, "conv-1"),
    null,
  );
});

test("parseArgs 接受 --once/--scenario/--account-index", () => {
  assert.deepEqual(parseArgs(["--once", "--scenario", "order_status"]), {
    once: true,
    scenario: "order_status",
    accountIndex: 0,
    help: false,
  });
  assert.equal(
    parseArgs(["--once", "--scenario", "order_status", "--account-index", "3"])
      .accountIndex,
    3,
  );
  assert.throws(() => parseArgs(["--once", "--scenario"]), /缺少参数值/);
  assert.throws(() => parseArgs(["--nope"]), /未知参数/);
});
