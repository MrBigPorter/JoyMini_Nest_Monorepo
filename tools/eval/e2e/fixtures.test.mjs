import assert from "node:assert/strict";
import test from "node:test";

import { verifyAction } from "./fixtures.mjs";

const address = (overrides) => ({
  addressId: overrides.addressId ?? "a1",
  label: overrides.label ?? "马尼拉办公室",
  city: overrides.city ?? "Makati",
  province: overrides.province ?? "Metro Manila",
  fullAddress: overrides.fullAddress ?? "Ayala Avenue 6750",
});

const emptyState = () => ({ addresses: [], coupons: [], tickets: [], withdrawals: [] });

test("coupon_owned_name：券列表里出现指定名字才算通过", () => {
  const before = emptyState();
  const after = {
    ...emptyState(),
    coupons: [{ userCouponId: "uc1", couponName: "Big Spender — ₱200 Off" }],
  };
  const result = verifyAction({ kind: "coupon_owned_name", name: "Big Spender" }, before, after);
  assert.equal(result.pass, true);
  assert.equal(result.evidence.afterCount, 1);

  const missing = verifyAction({ kind: "coupon_owned_name", name: "Big Spender" }, before, emptyState());
  assert.equal(missing.pass, false);
});

test("coupon_owned_name：之前就有一张同名券时，必须多出来一张才算领到", () => {
  const already = { ...emptyState(), coupons: [{ userCouponId: "uc1", couponName: "Big Spender — ₱200 Off" }] };
  const noChange = verifyAction({ kind: "coupon_owned_name", name: "Big Spender" }, already, already);
  assert.equal(noChange.pass, false);

  const increased = {
    ...emptyState(),
    coupons: [
      { userCouponId: "uc1", couponName: "Big Spender — ₱200 Off" },
      { userCouponId: "uc2", couponName: "Big Spender — ₱200 Off" },
    ],
  };
  const result = verifyAction({ kind: "coupon_owned_name", name: "Big Spender" }, already, increased);
  assert.equal(result.pass, true);
  assert.equal(result.evidence.coupon.userCouponId, "uc2");
});

test("coupon_owned_name：spec.name 缺省时退回 expected.couponName", () => {
  const after = { ...emptyState(), coupons: [{ couponName: "JoyMini E2E 兑换码 WELCOME2026" }] };
  const result = verifyAction(
    { kind: "coupon_owned_name" },
    emptyState(),
    after,
    { couponName: "WELCOME2026" },
  );
  assert.equal(result.pass, true);
});

test("coupon_owned_name：expectedKey 指定取哪个期望字段（兑换码券）", () => {
  const after = {
    ...emptyState(),
    coupons: [{ userCouponId: "uc9", couponName: "JoyMini E2E 兑换码 WELCOME2026" }],
  };
  const result = verifyAction(
    { kind: "coupon_owned_name", expectedKey: "redeemCouponName" },
    emptyState(),
    after,
    { couponName: "Big Spender", redeemCouponName: "WELCOME2026" },
  );
  assert.equal(result.pass, true);
  assert.match(result.detail[0], /WELCOME2026/);
});

test("draw_record：出现新的已使用抽奖券才算通过", () => {
  const before = { ...emptyState(), tickets: [{ id: "t1", used: false }] };
  const after = {
    ...emptyState(),
    tickets: [{ id: "t1", used: false }, { id: "t2", used: true }],
  };
  const result = verifyAction({ kind: "draw_record" }, before, after);
  assert.equal(result.pass, true);
  assert.equal(result.evidence.drawn.id, "t2");
});

test("draw_record：券被用掉（同一张 id）也算通过", () => {
  const before = { ...emptyState(), tickets: [{ id: "t1", used: false }] };
  const after = { ...emptyState(), tickets: [{ id: "t1", used: true }] };
  assert.equal(verifyAction({ kind: "draw_record" }, before, after).pass, true);
});

test("draw_record：动作前就已经用过的券不能冒充本次抽奖", () => {
  const before = { ...emptyState(), tickets: [{ id: "t1", used: true }] };
  const after = { ...emptyState(), tickets: [{ id: "t1", used: true }] };
  assert.equal(verifyAction({ kind: "draw_record" }, before, after).pass, false);
});

test("address_created：新增地址里要有目标城市", () => {
  const before = { ...emptyState(), addresses: [address({ addressId: "a1" })] };
  const after = {
    ...emptyState(),
    addresses: [
      address({ addressId: "a1" }),
      address({ addressId: "a2", label: "宿务仓", city: "Cebu City", fullAddress: "Lahug" }),
    ],
  };
  const hit = verifyAction({ kind: "address_created", city: "Cebu" }, before, after);
  assert.equal(hit.pass, true);
  assert.equal(hit.evidence.created.length, 1);

  const miss = verifyAction(
    { kind: "address_created", city: "Cebu" },
    before,
    { ...emptyState(), addresses: [address({ addressId: "a1" })] },
  );
  assert.equal(miss.pass, false);
});

test("address_changed：标签命中的地址城市真的变了", () => {
  const before = { ...emptyState(), addresses: [address({ addressId: "a1" })] };
  const after = { ...emptyState(), addresses: [address({ addressId: "a1", city: "Cebu City" })] };
  const result = verifyAction(
    { kind: "address_changed", label: "马尼拉办公室", city: "Cebu" },
    before,
    after,
  );
  assert.equal(result.pass, true);

  const unchanged = verifyAction(
    { kind: "address_changed", label: "马尼拉办公室", city: "Cebu" },
    before,
    before,
  );
  assert.equal(unchanged.pass, false);
});

test("address_removed：标签地址消失才算通过", () => {
  const before = { ...emptyState(), addresses: [address({ addressId: "a1", label: "碧瑶宿舍" })] };
  assert.equal(
    verifyAction({ kind: "address_removed", label: "碧瑶宿舍" }, before, emptyState()).pass,
    true,
  );
  assert.equal(
    verifyAction({ kind: "address_removed", label: "碧瑶宿舍" }, before, before).pass,
    false,
  );
});

test("address_removed：动作前就没有这个标签时不能算删除成功", () => {
  const result = verifyAction(
    { kind: "address_removed", label: "碧瑶宿舍" },
    emptyState(),
    emptyState(),
  );
  assert.equal(result.pass, false);
  assert.match(result.detail[0], /动作前就没有/);
});

test("withdraw_created：新增提现记录金额一致", () => {
  const before = { ...emptyState(), withdrawals: [{ withdrawNo: "w1", amount: 200 }] };
  const after = {
    ...emptyState(),
    withdrawals: [
      { withdrawNo: "w1", amount: 200 },
      { withdrawNo: "w2", amount: 200.0 },
    ],
  };
  assert.equal(verifyAction({ kind: "withdraw_created", amount: 200 }, before, after).pass, true);
  assert.equal(verifyAction({ kind: "withdraw_created", amount: 500 }, before, after).pass, false);
});

test("withdraw_created：读接口的 amount 为 0 时看 withdrawAmount", () => {
  const before = emptyState();
  const after = {
    ...emptyState(),
    withdrawals: [
      { withdrawNo: "w9", amount: "0.00", withdrawAmount: "200.00", actualAmount: "188.00" },
    ],
  };
  const result = verifyAction({ kind: "withdraw_created", amount: 200 }, before, after);
  assert.equal(result.pass, true);
  assert.equal(result.evidence.matched.withdrawNo, "w9");
});

test("未知 verify.kind 显式失败而不是静默通过", () => {
  const result = verifyAction({ kind: "nope" }, emptyState(), emptyState());
  assert.equal(result.pass, false);
  assert.match(result.detail[0], /未知/);
});
