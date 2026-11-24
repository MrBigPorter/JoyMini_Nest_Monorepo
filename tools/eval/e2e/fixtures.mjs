/**
 * 业务前置数据：**只用产品接口**（客户端 + admin），不写 SQL、不写 fixture 脚本注入。
 *
 * 每一步都是「先查后建」：
 *   - 已满足条件 → 记 reused
 *   - 需要造 → 走真实接口，记 created / updated
 *   - 造不出来 → 记 blocked，并让依赖它的用例在报告里显式 skip（不伪造通过）
 *
 * 所有副作用都能在 admin 后台看到；报告里会逐条列出本次做了什么。
 */
import { maskPhone } from "../../simulator/provision.mjs";
import { sleep } from "./http.mjs";

/** admin 侧建兑换码券用的码（来自 simulator 场景槽位池） */
export const REDEEM_CODES = Object.freeze([
  "WELCOME2026",
  "JOY888",
  "SIMTEST01",
]);

/** 场景里点名的那张可领券（BIG200 已发放过期，可领券模板由本脚本用 admin 接口建） */
export const CLAIM_COUPON_MATCH = "Big Spender";

/** 地址 fixture 的标签：AI 只能靠文本匹配，所以标签里放用户会说的城市名 */
export const ADDRESS_LABELS = Object.freeze({
  manila: "马尼拉办公室",
  baguio: "碧瑶宿舍",
});

/** 用户会说中/英混用；区域库只有英文名，匹配交给模型（真实能力） */
const REGION_TARGETS = Object.freeze({
  manila: { province: "Metro Manila", city: "Makati", barangay: "Bel-Air" },
  baguio: { province: "Metro Manila", city: "Quezon City", barangay: "Cubao" },
  cebu: { province: "Cebu", city: "Cebu City", barangay: "Lahug" },
});

const DAY_MS = 24 * 60 * 60 * 1000;
const SOLO_BALANCE_TARGET = 6000; // 单买价约 ₱2999 + 提现 ₱200 及手续费
const TICKET_POLL_MS = 500;
const TICKET_POLL_ATTEMPTS = 20;

const KYC_APPROVED = 4;
const DIRECTION_INCOME = 1;
const BALANCE_TYPE_CASH = 1;

function includesText(value, needle) {
  return String(value ?? "")
    .toLowerCase()
    .includes(String(needle).toLowerCase());
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatTime(ms) {
  if (!ms) return "无";
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

// ── 读接口（核验副作用也用同一批函数） ────────────────────────────────

export async function listAddresses(client) {
  const data = await client.request(
    "/v1/client/address/list?page=1&pageSize=100",
  );
  return Array.isArray(data?.list) ? data.list : [];
}

export async function listMyCoupons(client) {
  const data = await client.request(
    "/v1/client/coupons/me?page=1&pageSize=100",
  );
  return Array.isArray(data?.list) ? data.list : [];
}

export async function listTickets(client, { unusedOnly = false } = {}) {
  const query = unusedOnly
    ? "page=1&pageSize=20&unusedOnly=true"
    : "page=1&pageSize=50";
  const data = await client.request(`/v1/lucky-draw/my-tickets?${query}`);
  return Array.isArray(data?.list) ? data.list : [];
}

export async function listOrders(client) {
  const data = await client.request("/v1/orders/list", {
    method: "POST",
    body: { status: "all", page: 1, pageSize: 50 },
  });
  return Array.isArray(data?.list) ? data.list : [];
}

export async function listWithdrawals(client) {
  const data = await client.request(
    "/v1/wallet/withdraw/history?page=1&pageSize=50",
  );
  return Array.isArray(data?.list) ? data.list : [];
}

export async function getBalance(client) {
  return client.request("/v1/wallet/balance", { method: "POST" });
}

/** 动作前后各拍一次快照；判定只看这两次快照的差集。 */
export async function snapshotState(client) {
  const [addresses, coupons, tickets, withdrawals] = await Promise.all([
    listAddresses(client),
    listMyCoupons(client),
    listTickets(client),
    listWithdrawals(client),
  ]);
  return { addresses, coupons, tickets, withdrawals };
}

// ── 判定（纯函数，单测覆盖） ─────────────────────────────────────────

/**
 * 核验动作副作用。`spec` 来自 cases.mjs 的 `verify`；
 * `before` / `after` 是 snapshotState 的结果。
 */
export function verifyAction(spec, before, after, expected = {}) {
  const detail = [];
  const pass = (ok, message) => {
    detail.push(`${ok ? "通过" : "失败"}：${message}`);
    return ok;
  };

  switch (spec?.kind) {
    case "coupon_owned_name": {
      const name =
        spec.name ??
        (spec.expectedKey ? expected[spec.expectedKey] : expected.couponName);
      const matchingBefore = before.coupons.filter((item) =>
        includesText(item.couponName, name),
      );
      const matchingAfter = after.coupons.filter((item) =>
        includesText(item.couponName, name),
      );
      // 必须「多出来一张」：账号之前就有同名券时，只看「有」会掩盖没领到
      return {
        pass: pass(
          matchingAfter.length > matchingBefore.length,
          `我的券列表现有「${name}」${matchingAfter.length} 张（动作前 ${matchingBefore.length} 张）`,
        ),
        detail,
        evidence: {
          coupon: matchingAfter.find(
            (item) =>
              !matchingBefore.some(
                (beforeItem) => beforeItem.userCouponId === item.userCouponId,
              ),
          ) ?? null,
          beforeCount: matchingBefore.length,
          afterCount: matchingAfter.length,
        },
      };
    }

    case "draw_record": {
      const earlier = new Set(before.tickets.map((item) => item.id));
      const drawn = after.tickets.find(
        (item) => item.used === true && !earlier.has(item.id),
      );
      // 也可能是已有券从「未使用」变「已使用」，同样证明真抽了一次
      const consumed = after.tickets.find(
        (item) =>
          item.used === true &&
          before.tickets.some((beforeItem) => beforeItem.id === item.id && beforeItem.used !== true),
      );
      const hit = drawn ?? consumed ?? null;
      return {
        pass: pass(Boolean(hit), "抽奖券已被使用（抽奖记录已产生）"),
        detail,
        evidence: { drawn: hit },
      };
    }

    case "address_created": {
      const earlier = new Set(before.addresses.map((item) => item.addressId));
      const created = after.addresses.filter(
        (item) => !earlier.has(item.addressId),
      );
      const targetCity = spec.city ?? expected.addressCity ?? "Cebu";
      const matched = created.find(
        (item) =>
          includesText(item.city, targetCity) ||
          includesText(item.fullAddress, targetCity) ||
          includesText(item.label, targetCity),
      );
      return {
        pass: pass(
          created.length > 0 && Boolean(matched),
          `新增地址${created.length}条，其中包含 ${targetCity} 的地址`,
        ),
        detail,
        evidence: { created, matched: matched ?? null },
      };
    }

    case "address_changed": {
      const target = after.addresses.find((item) =>
        includesText(item.label, spec.label),
      );
      const beforeTarget = before.addresses.find(
        (item) => item.addressId === target?.addressId,
      );
      const ok =
        Boolean(target) &&
        includesText(target.city, spec.city ?? "Cebu") &&
        target.city !== beforeTarget?.city;
      return {
        pass: pass(
          ok,
          `标签「${spec.label}」的地址城市 ${beforeTarget?.city ?? "?"} → ${target?.city ?? "?"}`,
        ),
        detail,
        evidence: { before: beforeTarget ?? null, after: target ?? null },
      };
    }

    case "address_removed": {
      const existed = before.addresses.find((item) =>
        includesText(item.label, spec.label),
      );
      const still = after.addresses.find((item) =>
        includesText(item.label, spec.label),
      );
      const ok = Boolean(existed) && !still;
      return {
        pass: pass(
          ok,
          existed
            ? still
              ? `标签「${spec.label}」的地址仍然存在（未删除）`
              : `标签「${spec.label}」的地址已删除`
            : `动作前就没有标签「${spec.label}」的地址，无法证明删除生效`,
        ),
        detail,
        evidence: { existed: existed ?? null, remaining: still ?? null },
      };
    }

    case "withdraw_created": {
      const earlier = new Set(before.withdrawals.map((item) => item.withdrawNo));
      const created = after.withdrawals.filter(
        (item) => !earlier.has(item.withdrawNo),
      );
      const amount = toNumber(spec.amount ?? expected.withdrawAmount);
      // 提现记录的 `amount` 是订单金额字段（当前为 0.00），用户申请的金额在
      // `withdrawAmount`；两者都要看，避免字段口径变化时静默判错。
      const amountOf = (item) =>
        toNumber(item.withdrawAmount ?? item.amount ?? item.actualAmount);
      const matched = created.find((item) => amountOf(item) === amount);
      return {
        pass: pass(
          Boolean(matched),
          `提现记录新增 ${created.length} 条，含 ₱${amount}`,
        ),
        detail,
        evidence: { created, matched: matched ?? null },
      };
    }

    default:
      return {
        pass: false,
        detail: [`未知 verify.kind：${spec?.kind ?? "(空)"}`],
        evidence: null,
      };
  }
}

// ── fixture 编排 ─────────────────────────────────────────────────────

/**
 * 准备动作类前置数据。返回：
 *   ready     — 每个 prepareKey 是否可用
 *   slots     — 场景槽位的真实值
 *   expected  — 判定要用的真实名字/金额
 *   log       — 本次做了什么（新建/复用/修改）
 *   blockers  — 造不出来的原因（依赖用例据此 skip）
 */
export async function prepareFixtures({
  admin,
  client,
  logger = console,
  now = () => new Date(),
}) {
  const log = [];
  const blockers = [];
  const ready = {};
  const expected = {};

  const record = (step, status, detail) => {
    log.push({ step, status, detail });
    const label = `[e2e:fixture] ${step} → ${status}：${detail}`;
    if (status === "blocked") logger.warn?.(label);
    else logger.log?.(label);
  };

  const block = (step, reason) => {
    blockers.push({ step, reason });
    ready[step] = false;
    record(step, "blocked", reason);
  };

  const nowMs = now().getTime();

  async function stepResult(name, fn, required = true) {
    try {
      const value = await fn();
      ready[name] = true;
      return value;
    } catch (error) {
      const reason = error?.message ?? String(error);
      if (required) return block(name, reason);
      logger.warn?.(`[e2e:fixture] ${name} 非关键步骤失败：${reason}`);
      return null;
    }
  }

  // 0) 用户身份（后续 admin 操作与核验都要 userId）
  const profile = await client.request("/v1/auth/profile");
  const userId = profile?.id;
  if (!userId) throw new Error("GET /v1/auth/profile 未返回用户 id");
  expected.userId = userId;
  log.push({ step: "profile", status: "reused", detail: "已登录账号可用" });

  // 1) 可领券（场景点名的 Big Spender）：
  //    dev 里 BIG200 已过期，且「已发放」的券不允许改 validStartAt（admin 接口
  //    会 400），所以不硬改它；改用 admin 真实创建一张专供领券的模板。
  //    名字保留场景里的短语（加 E2E 后缀区分），perUserLimit 放宽，
  //    重复跑同一批账号也能领。
  const CLAIM_FIXTURE_NAME = `${CLAIM_COUPON_MATCH} — ₱200 Off (E2E)`;
  const coupon = await stepResult(
    "coupon_claim",
    async () => {
      const readClaimable = async () => {
        const data = await client.request("/v1/client/coupons/claimable");
        return Array.isArray(data) ? data : [];
      };

      const catalogs = await admin.listCoupons({ page: 1, pageSize: 100 });
      const list = Array.isArray(catalogs?.list) ? catalogs.list : [];
      let template = list.find(
        (item) => item.couponName === CLAIM_FIXTURE_NAME,
      );

      if (template) {
        const validEnd = new Date(template.validEndAt ?? 0).getTime();
        if (!Number.isFinite(validEnd) || validEnd < nowMs + 5 * 60 * 1000) {
          const validEndAt = new Date(nowMs + 30 * DAY_MS).toISOString();
          await admin.updateCoupon(template.id, { validEndAt });
          record(
            "coupon_claim",
            "updated",
            `领券模板 ${CLAIM_FIXTURE_NAME} 有效期续到 ${formatTime(nowMs + 30 * DAY_MS)}`,
          );
        }
      } else {
        template = await admin.createCoupon({
          couponName: CLAIM_FIXTURE_NAME,
          couponType: 1,
          discountType: 1,
          discountValue: 200,
          minPurchase: 500,
          issueType: 2,
          totalQuantity: 100000,
          perUserLimit: 100,
          validType: 1,
          validStartAt: new Date(nowMs - DAY_MS).toISOString(),
          validEndAt: new Date(nowMs + 30 * DAY_MS).toISOString(),
          description: "E2E acceptance fixture: claimable coupon",
        });
        record(
          "coupon_claim",
          "created",
          `创建可领券模板 ${CLAIM_FIXTURE_NAME}`,
        );
      }

      const claimable = await readClaimable();
      const entry = claimable.find(
        (item) => item.couponId === template.id,
      );
      if (!entry) {
        throw new Error("领券中心没有返回本次创建的模板（有效期/状态异常）");
      }
      if (!entry.canClaim) {
        throw new Error("该账号当前不能领取该券（已领/超限/库存不足）");
      }
      expected.claimCouponName = entry.couponName;
      return { id: entry.couponId, couponName: entry.couponName };
    },
    true,
  );

  // 2) 兑换码券：admin 真实创建（issueType=3）
  const redeemCoupon = await stepResult(
    "coupon_redeem",
    async () => {
      const code = REDEEM_CODES[0];
      const couponName = `JoyMini E2E 兑换码 ${code}`;
      const catalog = await admin.listCoupons({ page: 1, pageSize: 100 });
      const list = Array.isArray(catalog?.list) ? catalog.list : [];
      const existing = list.find((item) => item.couponCode === code);
      if (existing) {
        const patch = {};
        if (toNumber(existing.validEndAt) < nowMs + 5 * 60 * 1000) {
          patch.validEndAt = new Date(nowMs + 30 * DAY_MS).toISOString();
        }
        // 这个码每次验收都要真兑换一次；每用户限领 1 张会让第二次运行直接失败。
        if (toNumber(existing.perUserLimit) < 100) patch.perUserLimit = 100;
        if (Object.keys(patch).length > 0) {
          await admin.updateCoupon(existing.id, patch);
          record(
            "coupon_redeem",
            "updated",
            `${code} 参数已续期/放宽（${Object.keys(patch).join(", ")}）`,
          );
        } else {
          record("coupon_redeem", "reused", `${code} 已存在且有效`);
        }
        expected.redeemCouponName = existing.couponName;
        return existing;
      }

      const created = await admin.createCoupon({
        couponName,
        couponCode: code,
        couponType: 3,
        discountType: 1,
        discountValue: 10,
        minPurchase: 0,
        issueType: 3,
        totalQuantity: 1000,
        perUserLimit: 1,
        validType: 1,
        validStartAt: new Date(nowMs - DAY_MS).toISOString(),
        validEndAt: new Date(nowMs + 30 * DAY_MS).toISOString(),
        description: "E2E acceptance fixture",
      });
      record("coupon_redeem", "created", `创建兑换码券 ${code}`);
      expected.redeemCouponName = created?.couponName ?? couponName;
      return created;
    },
    true,
  );

  // 3) 区域 ID（产品接口，不查库）
  const region = await client.request("/v1/client/region/provinces");
  async function resolveRegion(target) {
    const provinces = Array.isArray(region) ? region : [];
    const province = provinces.find((item) =>
      includesText(item.provinceName, target.province),
    );
    if (!province) throw new Error(`区域库没有省 ${target.province}`);
    const cities = await client.request(
      `/v1/client/region/cities/${province.provinceId}`,
    );
    const city = (Array.isArray(cities) ? cities : []).find((item) =>
      includesText(item.cityName, target.city),
    );
    if (!city) throw new Error(`区域库没有市 ${target.city}`);
    const barangays = await client.request(
      `/v1/client/region/barangays/${city.cityId}`,
    );
    const barangay = (Array.isArray(barangays) ? barangays : []).find((item) =>
      includesText(item.barangayName, target.barangay),
    );
    if (!barangay) throw new Error(`区域库没有区 ${target.barangay}`);
    return {
      provinceId: province.provinceId,
      cityId: city.cityId,
      barangayId: barangay.barangayId,
    };
  }

  const manilaRegion = await resolveRegion(REGION_TARGETS.manila);
  const baguioRegion = await resolveRegion(REGION_TARGETS.baguio);
  const cebuRegion = await resolveRegion(REGION_TARGETS.cebu);

  /** 建/修复一个「标签唯一」的地址；上次跑被改过城市时恢复原城市。 */
  async function ensureAddress(label, target, regionIds) {
    const addresses = await listAddresses(client);
    const existing = addresses.find((item) => includesText(item.label, label));
    const body = {
      contactName: "Maria Santos",
      phone: expected.phone,
      provinceId: regionIds.provinceId,
      cityId: regionIds.cityId,
      barangayId: regionIds.barangayId,
      fullAddress: target.fullAddress,
      label,
      isDefault: 0,
    };

    if (existing) {
      if (
        includesText(existing.city, REGION_TARGETS[target.key].city) &&
        includesText(existing.province, REGION_TARGETS[target.key].province)
      ) {
        record(label, "reused", `地址「${label}」已存在（${existing.city}）`);
        return existing;
      }
      await client.request(
        `/v1/client/address/update/${existing.addressId}`,
        { method: "POST", body },
      );
      record(
        label,
        "updated",
        `地址「${label}」恢复到 ${REGION_TARGETS[target.key].city}`,
      );
      return existing;
    }

    const created = await client.request("/v1/client/address/create", {
      method: "POST",
      body,
    });
    record(label, "created", `创建地址「${label}」（${target.fullAddress}）`);
    return created;
  }

  const phone = client.account?.phone;
  if (!phone) throw new Error("账号缺少 phone，无法构造地址联系人");
  expected.phone = phone;

  await stepResult(
    "address_manila",
    () =>
      ensureAddress(ADDRESS_LABELS.manila, {
        key: "manila",
        fullAddress: "Ayala Avenue 6750, Bel-Air",
      }, manilaRegion),
    true,
  );

  await stepResult(
    "address_baguio",
    () =>
      ensureAddress(ADDRESS_LABELS.baguio, {
        key: "baguio",
        fullAddress: "Cubao Commercial Center, Unit 12",
      }, baguioRegion),
    true,
  );

  // 4) KYC 审批（提现前置）：已通过就复用
  await stepResult(
    "withdraw_ready",
    async () => {
      const kyc = await client.request("/v1/kyc/me").catch(() => null);
      if (kyc?.kycStatus === KYC_APPROVED) {
        record("withdraw_ready", "reused", "KYC 已通过");
        return kyc;
      }
      await admin.createKyc({
        userId,
        realName: "E2E Test User",
        idNumber: "E2E-20261123-0001",
        idType: 1,
        remark: "E2E acceptance fixture",
      });
      const afterKyc = await client.request("/v1/kyc/me");
      if (afterKyc?.kycStatus !== KYC_APPROVED) {
        throw new Error(`admin 创建 KYC 后状态仍为 ${afterKyc?.kycStatus}`);
      }
      record("withdraw_ready", "created", "admin 创建并直接通过 KYC");
      return afterKyc;
    },
    true,
  );

  // 5) 余额：足够单买 + 提现
  await stepResult(
    "wallet_funds",
    async () => {
      const balance = await getBalance(client);
      const real = toNumber(balance?.realBalance);
      if (real >= SOLO_BALANCE_TARGET) {
        record("wallet_funds", "reused", `余额 ₱${real} 已充足`);
        return balance;
      }
      const amount = Number((SOLO_BALANCE_TARGET - real).toFixed(2));
      await admin.adjustBalance({
        userId,
        actionType: DIRECTION_INCOME,
        balanceType: BALANCE_TYPE_CASH,
        amount,
        remark: "E2E acceptance fixture top-up",
      });
      record("wallet_funds", "created", `admin 充值 ₱${amount}`);
      return getBalance(client);
    },
    true,
  );

  // 提现要同时满足「KYC 通过 + 余额够」；任一不成就整体跳过提现用例
  if (ready.withdraw_ready && !ready.wallet_funds) {
    ready.withdraw_ready = false;
    const reason = "提现前置余额未就绪（wallet_funds 失败）";
    blockers.push({ step: "withdraw_ready", reason });
    record("withdraw_ready", "blocked", reason);
  }

  // 6) 抽奖券：有未使用的就复用，否则真实下单（单独购买）等待异步发票
  await stepResult(
    "lucky_ticket",
    async () => {
      let tickets = await listTickets(client, { unusedOnly: true });
      if (tickets.length > 0) {
        record(
          "lucky_ticket",
          "reused",
          `已有未使用抽奖券 ${tickets.length} 张`,
        );
        expected.ticketId = tickets[0].id;
        return tickets[0];
      }

      const catalog = await client.request(
        "/v1/treasure?page=1&pageSize=100&state=1",
      );
      const list = Array.isArray(catalog?.list) ? catalog.list : [];
      const candidates = list
        .filter(
          (item) =>
            toNumber(item.soloAmount) > 0 &&
            toNumber(item.seqShelvesQuantity) -
              toNumber(item.seqBuyQuantity) >
              0,
        )
        .sort((a, b) => toNumber(a.soloAmount) - toNumber(b.soloAmount));
      if (candidates.length === 0) {
        throw new Error("没有可单买的商品（soloAmount/库存不足）");
      }
      const treasure = candidates[0];
      const checkout = await client.request("/v1/orders/checkout", {
        method: "POST",
        body: {
          treasureId: treasure.treasureId,
          entries: 1,
          isGroup: false,
          paymentMethod: 1,
        },
      });
      record(
        "lucky_ticket",
        "created",
        `单买「${treasure.treasureName}」orderId=${checkout?.orderId}，等待异步发券`,
      );

      for (let attempt = 0; attempt < TICKET_POLL_ATTEMPTS; attempt += 1) {
        await sleep(TICKET_POLL_MS);
        tickets = await listTickets(client, { unusedOnly: true });
        if (tickets.length > 0) {
          expected.ticketId = tickets[0].id;
          return tickets[0];
        }
      }
      throw new Error("下单成功但 10 秒内没有收到抽奖券（异步发票失败）");
    },
    true,
  );

  // 7) 订单（读类用例要真实 orderId；有历史订单直接复用最新一单）
  await stepResult(
    "order",
    async () => {
      const orders = await listOrders(client);
      if (orders.length === 0) throw new Error("账号没有任何订单");
      const latest = orders[0];
      record("order", "reused", `使用既有订单 ${latest.orderNo ?? latest.orderId}`);
      return latest;
    },
    true,
  );

  const orders = await listOrders(client).catch(() => []);
  const latestOrder = orders[0];

  const slots = {
    // 场景槽位（{city} 用中文，考察模型对区域库英文名的映射能力）
    city: "宿务",
    amount: "200",
    product: "蓝牙耳机",
    code: redeemCoupon ? REDEEM_CODES[0] : undefined,
    orderId: latestOrder?.orderId,
    // 写动作槽位
    redeemCode: redeemCoupon ? REDEEM_CODES[0] : undefined,
    withdrawAmount: "200",
    withdrawAccount: "09171234567",
    withdrawAccountName: "Maria Santos",
    contactPhone: expected.phone,
    createAddressCity: "宿务",
    createAddressProvince: "Cebu",
    createAddressCityEn: "Cebu City",
    createAddressBarangay: "Lahug",
    createAddressFull: "Cebu City, Lahug, JY Square Mall 3F Unit 302",
    createAddressCityMatch: "Cebu",
    deleteAddressCity: "碧瑶",
  };

  return {
    userId,
    slots,
    expected: {
      ...expected,
      claimCouponId: coupon?.id ?? null,
      redeemCouponName: expected.redeemCouponName ?? null,
      withdrawAmount: 200,
      orderId: latestOrder?.orderId ?? null,
      region: { manilaRegion, baguioRegion, cebuRegion },
    },
    ready,
    log,
    blockers,
  };
}

export { maskPhone };
