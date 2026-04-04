# Flutter 端订单状态对齐说明（Admin / Client / API）

## 1. 问题陈述

- **要解决的问题**：后台已经出现 `Ready to Ship`（`orderStatus=7`）等新状态，但 Flutter 侧按 `status=paid/unpaid/refunded/cancelled` 查询时查不到，导致“后台有单，前端看不到”。
- **目标**：明确 Flutter 是否必须改、最小改动集是什么、如何兼容上线不翻车。
- **范围**：仅针对订单列表/详情的状态查询与展示（不改支付、退款业务流程本身）。
- **输出物**：状态契约对照、改造清单、兼容策略、回归测试清单、上线顺序。
- **不做**：不在本文定义新的运营业务规则（例如“paid”是否应包含全生命周期）。

---

## 2. 当前契约事实（以代码为准）

### 2.1 订单状态全集（共享常量）

来源：`packages/shared/src/types/order.ts`

- `1` `PENDING_PAYMENT`
- `2` `PROCESSING_PAYMENT`
- `3` `PAID`
- `4` `CANCELED`
- `5` `REFUNDED`
- `6` `WAIT_GROUP`
- `7` `WAIT_DELIVERY`（UI 文案：`Ready to Ship`）
- `8` `SHIPPED`
- `9` `COMPLETED`

### 2.2 Client 订单列表查询参数（移动端常用）

来源：

- `apps/api/src/client/orders/dto/list-orders.dto.ts`
- `apps/api/src/client/orders/order.service.ts` 的 `whereByStatus`

当前只支持：`all | paid | unpaid | refunded | cancelled`

且 `paid` 的实际过滤逻辑是：

- `payStatus = PAID`
- `orderStatus = PAID(3)`
- `refundStatus = NO_REFUND`

**结论**：`Ready to Ship(7)`、`Shipped(8)`、`Completed(9)` 不会落入 `status=paid` 查询结果，这是当前设计，不是 Flutter 单端 bug。

---

## 3. Flutter 端到底要不要改？

## 3.1 结论

- **需要改**（推荐立即排期）。
- 原因：即使后端不扩展接口，Flutter 也至少要做“未知状态兼容”，避免收到 `6/7/8/9` 时文案/颜色/按钮错乱。

## 3.2 影响分级

- **必须改（P0）**
  - 状态文案映射（支持 1-9）
  - 状态颜色映射（支持 1-9）
  - 未知状态兜底（`Unknown(<raw>)`）
- **强烈建议改（P0）**
  - 筛选维度与后端对齐（不要默认“paid 就是所有已付款后状态”）
- **可选改（P1）**
  - 新增细粒度 Tabs（Ready to Ship / Shipped / Completed）

---

## 4. 推荐改造方案

## 方案 A（最小风险，先可用）

- 保持后端接口不变（仍是 `status=all/paid/unpaid/refunded/cancelled`）
- Flutter 先完成：
  1. 订单项状态展示全量兼容（1-9）
  2. 在“全部”列表中正确显示 `Ready to Ship/Shipped/Completed`

优点：改动最小，发布快。  
缺点：筛选维度仍粗，不支持单独筛 `Ready to Ship`。

## 方案 B（推荐，语义更完整）

后端扩展 Client 查询枚举（兼容旧值）：

- 新增 `status` 可选值：`wait_group | ready_to_ship | shipped | completed`

同时在 `whereByStatus` 增加映射：

- `wait_group -> orderStatus=6`
- `ready_to_ship -> orderStatus=7`
- `shipped -> orderStatus=8`
- `completed -> orderStatus=9`

Flutter 同步新增对应 tab/filter。

---

## 5. Flutter 最小改动清单（建议直接照单执行）

1. 新增本地状态枚举（或常量）覆盖 1-9。
2. 新增 `statusLabel(statusCode)` 映射，文案与共享常量保持一致。
3. 新增 `statusColor(statusCode)` 映射，所有状态有颜色。
4. 详情页按钮矩阵与状态一致（至少不要在不合法状态展示错误操作按钮）。
5. 任何状态解析失败时统一兜底：`Unknown(<code>)`，并上报埋点。

建议按钮矩阵（可按产品策略微调）：

- `3(PAID)` / `7(READY_TO_SHIP)`：显示 `Ship`
- `8(SHIPPED)`：显示 `Mark Completed`
- `1/3/6/7`：允许 `Cancel`
- `4/5/9`：只读

---

## 6. 回归测试清单（Flutter）

- 列表页：`all` 返回包含 `7/8/9` 时，文案/颜色正确，无崩溃。
- 详情页：不同状态下按钮显隐正确（尤其 7 和 8）。
- 筛选页：`paid` 仅显示 `orderStatus=3`（与后端当前语义一致）。
- 向后兼容：老版本收到新状态时，不崩溃（至少兜底显示）。
- 分页与搜索组合：`status + page + pageSize + treasureId` 正常。

---

## 7. 建议上线顺序

1. 后端先发兼容（若采用方案 B，先扩枚举，旧值不破坏）。
2. Flutter 发“读兼容版本”（先支持展示 1-9）。
3. 再灰度开启细粒度筛选 tab（ready_to_ship/shipped/completed）。
4. 观察 24h：状态分布、筛选命中率、空列表异常率。

---

## 8. 心智模型提问（沉淀）

1. 当状态机升级时，我们是先改“服务端兼容”，还是先改“客户端容错”？为什么？
2. `paid` 在产品语义上代表“已付款瞬间”，还是“支付后全生命周期”？谁来定义且如何写进契约？
3. 如果旧客户端收到新状态码，它应该“降级可用”还是“阻断并强更”？依据是什么（风险/成本/体验）？
4. 状态文案、颜色、可操作按钮，是否应该全部来自同一份共享契约（单一事实源）？

---

## 9. 结论

- 这次问题本质是**状态语义分层不一致**，不是单纯某一端 bug。
- Flutter 端**需要改**，至少做全状态展示与兜底。
- 若要让用户能“按 Ready to Ship 等状态筛选”，需要后端 Client API 同步扩展查询枚举（或提供新参数）。
