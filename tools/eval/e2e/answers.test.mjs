import assert from "node:assert/strict";
import test from "node:test";

import { createAnswerDriver } from "./answers.mjs";

const slots = {
  contactPhone: "09171234567",
  createAddressProvince: "Cebu",
  createAddressCityEn: "Cebu City",
  createAddressBarangay: "Lahug",
  createAddressFull: "JY Square Mall 3F Unit 302, Lahug",
};

test("create_address：按 AI 的表单式追问逐字段作答", () => {
  const next = createAnswerDriver({ action: "create_address", slots });
  assert.equal(next("请问收货人姓名用哪个？"), "Maria Santos");
  assert.equal(next("联系电话是多少？"), "09171234567");
  assert.equal(next("请问在哪个省份？"), "Cebu");
  assert.equal(next("哪个城市或市镇？"), "Cebu City");
  assert.equal(next("具体的 barangay 是？"), "Lahug");
  assert.equal(next("请补充详细地址（街道/楼栋）"), "JY Square Mall 3F Unit 302, Lahug");
  assert.equal(next("要加个标签吗？比如家/公司"), "宿务仓");
});

test("create_address：同一个字段问两次也不重复编第二个答案", () => {
  const next = createAnswerDriver({ action: "create_address", slots });
  assert.equal(next("收货人姓名？"), "Maria Santos");
  assert.equal(next("请再告诉我收货人姓名"), null);
});

test("create_address：AI 请确认时答「确认」", () => {
  const next = createAnswerDriver({ action: "create_address", slots });
  assert.equal(next("请确认以下地址信息，确认后我就创建："), "确认，帮我保存这个地址");
});

test("update_address：先澄清是订单地址还是账户地址", () => {
  const next = createAnswerDriver({ action: "update_address", slots });
  assert.equal(
    next("您是想修改订单的收货地址，还是更新账户中的默认收货地址？"),
    "账户里的收货地址",
  );
  assert.equal(next("新的城市是？"), "Cebu City");
});

test("非地址动作：不猜字段，只认确认话术", () => {
  const next = createAnswerDriver({ action: "withdraw", slots });
  assert.equal(next("请问收货人姓名？"), null);
  assert.equal(next("请确认提现信息："), "确认");
});

test("答非所问的兜底文本不会被硬凑成答案", () => {
  const next = createAnswerDriver({ action: "create_address", slots });
  assert.equal(
    next("I'm sorry, I couldn't find specific information about that in our policy documents."),
    null,
  );
});

test("确认话术带动作名，避免单说「确认」被路由到别的意图", () => {
  const create = createAnswerDriver({ action: "create_address", slots });
  assert.match(create("请确认是否保存这个地址？"), /保存/);
  const del = createAnswerDriver({ action: "delete_address", slots, label: "碧瑶宿舍" });
  assert.match(del("请确认是否删除该地址？"), /删除/);
});

test("update_address：AI 问哪一个地址时报出目标标签", () => {
  const next = createAnswerDriver({ action: "update_address", slots, label: "马尼拉办公室" });
  assert.equal(next("我需要确认具体是哪一个地址：1. 马尼拉办公室 2. 碧瑶宿舍"), "马尼拉办公室");
});

test("预览复述省/城市时不要把它当成再问一遍字段", () => {
  const next = createAnswerDriver({ action: "create_address", slots });
  assert.equal(next("我整理一下：省/地区 Cebu，城市 Cebu City。请确认是否保存这个地址？"), "确认，帮我保存这个地址");
});
