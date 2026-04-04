# Lucky Nest Admin — 已完成核心功能文档

> **最后更新**: 2026-03-20（Phase 6-IM Phase 2 多客服渠道 + Admin UI）  
> **阶段**: Phase 6-IM Phase 2（进行中，OAuth/Email 顺延）  
> **约定**: 所有 Admin 接口路径以 `/v1/` 为 baseURL 前缀，受 `AdminJwtAuthGuard` + `RolesGuard` 双重保护。

---

## 目录

1. [认证系统](#1-认证系统)
2. [后台用户管理](#2-后台用户管理)
3. [RBAC 角色权限管理](#3-rbac-角色权限管理)
4. [客户端用户管理 & KYC](#4-客户端用户管理--kyc)
5. [收货地址管理](#5-收货地址管理)
6. [产品（夺宝）管理](#6-产品夺宝管理)
7. [分类管理](#7-分类管理)
8. [活动区块（Act Section）](#8-活动区块act-section)
9. [Banner 管理](#9-banner-管理)
10. [订单管理](#10-订单管理)
11. [拼团管理](#11-拼团管理)
12. [营销 / 优惠券](#12-营销--优惠券)
13. [财务中心](#13-财务中心)
14. [支付渠道管理](#14-支付渠道管理)
15. [数据分析仪表板](#15-数据分析仪表板)
16. [操作日志审计](#16-操作日志审计)
17. [通知 / 推送管理（Firebase FCM）](#17-通知--推送管理firebase-fcm)
18. [地区数据（Region）](#18-地区数据region)
19. [客服接待台（IM Chat Moderation）](#19-客服接待台im-chat-moderation)
20. [客服渠道管理（Support Channels）](#20-客服渠道管理support-channels)

---

## 1. 认证系统

### 后端接口

| 方法   | 路径                          | 说明                                     |
| ------ | ----------------------------- | ---------------------------------------- |
| `POST` | `/v1/auth/admin/login`        | 管理员密码登录，返回 JWT accessToken     |
| `POST` | `/v1/auth/admin/logout`       | 登出（服务端清理 Cookie）                |
| `POST` | `/v1/auth/admin/set-cookie`   | 将 token 写入 HTTP-only Cookie（防 XSS） |
| `POST` | `/v1/auth/admin/clear-cookie` | 清除 HTTP-only Cookie                    |

### 关键代码

```
apps/api/src/admin/auth/
  ├── auth.controller.ts      # 上述4个路由
  ├── auth.service.ts         # 密码校验 + JWT 签发（ADMIN_JWT_SECRET）
  └── admin-jwt.strategy.ts   # AdminJwtStrategy，解析 Admin Token

apps/admin-next/src/
  ├── store/useAuthStore.ts   # login() 双写 localStorage + HTTP-only Cookie
  └── app/(auth)/login/       # 登录页面
```

### 技术约定

- Admin JWT 使用独立密钥 `ADMIN_JWT_SECRET`（与客户端 `JWT_SECRET` 完全隔离）
- Cookie 名: `auth_token`（HttpOnly, SameSite=Strict）
- `middleware.ts` 在 `standalone` 模式下保护所有 `/(dashboard)/*` 路由

---

## 2. 后台用户管理

### 后端接口

| 方法     | 路径                    | 权限                    | 说明                                                        |
| -------- | ----------------------- | ----------------------- | ----------------------------------------------------------- |
| `GET`    | `/v1/admin/user/list`   | `USER:view_user`        | 分页查询管理员列表，支持 username/realName/role/status 筛选 |
| `POST`   | `/v1/admin/user/create` | `USER:create_user`      | 创建管理员（默认密码 `123456`）                             |
| `PATCH`  | `/v1/admin/user/:id`    | `USER:update_user_info` | 修改 realName / role / status / password                    |
| `DELETE` | `/v1/admin/user/:id`    | `USER:delete_user`      | 软删除（改名为 `deleted_xxxx`，status=0）                   |

### 关键代码

```
apps/api/src/admin/user/
  ├── user.controller.ts
  ├── user.service.ts
  └── dto/
      ├── admin-list.dto.ts
      ├── create-admin.dto.ts
      └── update-admin.dto.ts

apps/admin-next/src/
  ├── app/(dashboard)/admin-users/page.tsx   # Server Component + Suspense
  ├── components/admin-users/AdminUsersClient.tsx
  └── views/AdminUserManagement.tsx          # 列表 + 新增/编辑弹窗
      └── views/admin/
          ├── CreateAdminModal.tsx
          └── EditAdminUserModal.tsx
```

### 数据模型

```prisma
model AdminUser {
  id          String   @id @default(cuid())
  username    String   @unique
  password    String
  realName    String?
  role        String   // Role enum: SUPER_ADMIN|ADMIN|EDITOR|VIEWER|FINANCE
  status      Int      // 1=active, 0=inactive
  lastLoginAt DateTime?
  lastLoginIp String?
  createdAt   DateTime @default(now())
}
```

---

## 3. RBAC 角色权限管理

### 后端接口

| 方法  | 路径                           | 权限                 | 说明                                                     |
| ----- | ------------------------------ | -------------------- | -------------------------------------------------------- |
| `GET` | `/v1/admin/user/roles-summary` | `SYSTEM:update_role` | 返回所有角色的描述、权限列表（按模块分组）、活跃用户人数 |

### 角色体系

| 角色          | 说明       | 主要权限范围                                |
| ------------- | ---------- | ------------------------------------------- |
| `SUPER_ADMIN` | 超级管理员 | 全部权限（不受 PermissionsGuard 限制）      |
| `ADMIN`       | 普通管理员 | 用户查看/修改/封禁、订单查看/导出、营销全部 |
| `EDITOR`      | 运营/编辑  | 用户查看、营销全部（无删除）                |
| `VIEWER`      | 观察者     | 用户/订单/营销只读                          |
| `FINANCE`     | 财务专员   | 财务查看/审核/导出、订单查看/导出           |

### 关键代码

```
packages/shared/src/config/rbac.config.ts    # RolePermissions + RoleDescriptions
packages/shared/src/types/enums.ts           # Role enum
packages/shared/src/constants/operation-log.constants.ts  # OpModule + OpAction 常量

apps/api/src/common/guards/permissions.guard.ts   # PermissionsGuard 实现
apps/api/src/common/decorators/require-permission.decorator.ts

apps/admin-next/src/
  ├── app/(dashboard)/roles/page.tsx
  ├── components/roles/RolesClient.tsx
  └── views/RolesManagement.tsx   # 角色卡片网格 + 内联用户面板
```

### 权限字符串格式

```
{OpModule}:{OpAction}
示例: "user_management:view_user"
      "finance_management:audit_withdraw"
      "system_management:update_role"
```

---

## 4. 客户端用户管理 & KYC

### 后端接口

#### 用户管理

| 方法     | 路径                                           | 权限              | 说明                               |
| -------- | ---------------------------------------------- | ----------------- | ---------------------------------- |
| `GET`    | `/v1/admin/client-user/list`                   | `USER:view_user`  | 分页查询客户端用户，支持多字段筛选 |
| `GET`    | `/v1/admin/client-user/:id`                    | `USER:view_user`  | 用户详情（含设备、余额）           |
| `PATCH`  | `/v1/admin/client-user/:id/status`             | `USER:ban_user`   | 封禁/解封用户                      |
| `GET`    | `/v1/admin/client-user/:id/devices`            | `USER:view_user`  | 用户设备列表                       |
| `POST`   | `/v1/admin/client-user/device/ban`             | `USER:ban_user`   | 封禁设备                           |
| `DELETE` | `/v1/admin/client-user/device/unban/:deviceId` | `USER:unban_user` | 解封设备                           |

#### KYC 审核

| 方法     | 路径                           | 权限               | 说明                              |
| -------- | ------------------------------ | ------------------ | --------------------------------- |
| `GET`    | `/v1/admin/kyc/records`        | `USER:audit_kyc`   | 分页查询 KYC 记录（支持状态筛选） |
| `GET`    | `/v1/admin/kyc/records/:id`    | `USER:audit_kyc`   | KYC 详情（含证件照片）            |
| `POST`   | `/v1/admin/kyc/:id/audit`      | `USER:audit_kyc`   | 审核通过/拒绝                     |
| `PUT`    | `/v1/admin/kyc/update/:userId` | `USER:audit_kyc`   | 更新 KYC 信息                     |
| `POST`   | `/v1/admin/kyc/revoke/:userId` | `USER:audit_kyc`   | 撤销认证                          |
| `DELETE` | `/v1/admin/kyc/delete/:userId` | `USER:delete_user` | 删除 KYC 记录                     |
| `POST`   | `/v1/admin/kyc/create`         | `USER:audit_kyc`   | 手动录入 KYC                      |

### 关键代码

```
apps/api/src/admin/client-user/
apps/api/src/admin/kyc/

apps/admin-next/src/
  ├── app/(dashboard)/users/page.tsx
  ├── app/(dashboard)/kyc/page.tsx
  ├── views/UserManagement.tsx        # 用户列表 + 详情抽屉
  ├── views/user-management/
  │   ├── UserDetailDrawer.tsx
  │   └── BanUserModal.tsx
  └── views/KycList.tsx
      └── views/kyc/KycDetailDrawer.tsx
```

### KYC 状态机

```
NONE(0) → PENDING(1) → VERIFIED(4)
                     → FAILED(2) → PENDING(1)  [重新提交]
VERIFIED(4) → NONE(0)  [revoke]
```

---

## 5. 收货地址管理

### 后端接口

| 方法     | 路径                                  | 说明                               |
| -------- | ------------------------------------- | ---------------------------------- |
| `GET`    | `/v1/admin/address/list`              | 分页查询地址，支持用户 ID/省市筛选 |
| `GET`    | `/v1/admin/address/:id`               | 地址详情                           |
| `POST`   | `/v1/admin/address/update/:id`        | 修改地址                           |
| `DELETE` | `/v1/admin/address/delete/:id`        | 删除地址                           |
| `GET`    | `/v1/admin/region/provinces`          | 省份列表（菲律宾）                 |
| `GET`    | `/v1/admin/region/cities/:provinceId` | 城市列表                           |
| `GET`    | `/v1/admin/region/barangays/:cityId`  | 乡镇列表                           |

### 关键代码

```
apps/api/src/admin/address/
apps/api/src/admin/region/

apps/admin-next/src/
  ├── app/(dashboard)/address/page.tsx
  └── views/AddressList.tsx
```

---

## 6. 产品（夺宝）管理

### 后端接口

| 方法     | 路径                                  | 权限                              | 说明                                     |
| -------- | ------------------------------------- | --------------------------------- | ---------------------------------------- |
| `GET`    | `/v1/admin/treasure/list`             | `TREASURE:view_treasure`          | 分页查询产品，支持名称/状态筛选          |
| `GET`    | `/v1/admin/treasure/:id`              | `TREASURE:view_treasure`          | 产品详情（含 bonusConfig）               |
| `POST`   | `/v1/admin/treasure/create`           | `TREASURE:create_treasure`        | 创建产品（含图片上传、库存、机器人配置） |
| `PATCH`  | `/v1/admin/treasure/:id`              | `TREASURE:update_treasure`        | 修改产品                                 |
| `PATCH`  | `/v1/admin/treasure/:id/state`        | `TREASURE:on_shelf` / `off_shelf` | 上架/下架                                |
| `DELETE` | `/v1/admin/treasure/:id`              | `TREASURE:delete_treasure`        | 删除产品                                 |
| `POST`   | `/v1/admin/treasure/purge-home-cache` | —                                 | 清除首页缓存（Redis）                    |

### 关键代码

```
apps/api/src/admin/treasure/

apps/admin-next/src/
  ├── app/(dashboard)/products/page.tsx
  └── views/ProductManagement.tsx
      └── views/product/
          ├── CreateProductModal.tsx   # 多步骤表单（基本信息/库存/图片/赠品）
          └── EditProductModal.tsx
```

### 核心字段

- `seqShelvesQuantity`: 上架库存量
- `seqBuyQuantity`: 当前已购量（决定开奖进度）
- `buyQuantityRate`: 模拟购买速率（0-1）
- `bonusConfig`: JSON，赠品配置（winnerCount、bonusItemName）
- `state`: 0=未上架, 1=上架中, 2=已开奖, 3=已下架

---

## 7. 分类管理

### 后端接口

| 方法     | 路径                           | 说明                              |
| -------- | ------------------------------ | --------------------------------- |
| `GET`    | `/v1/admin/category/list`      | 分类列表（含 productCount）       |
| `GET`    | `/v1/admin/category/:id`       | 分类详情                          |
| `POST`   | `/v1/admin/category/create`    | 创建分类（name、icon、sortOrder） |
| `PATCH`  | `/v1/admin/category/:id`       | 修改分类                          |
| `PATCH`  | `/v1/admin/category/:id/state` | 启用/禁用分类                     |
| `DELETE` | `/v1/admin/category/:id`       | 删除分类                          |

### 关键代码

```
apps/api/src/admin/category/

apps/admin-next/src/
  ├── app/(dashboard)/categories/page.tsx
  └── views/CategoryManagement.tsx
      └── views/category/CategoryModal.tsx
```

---

## 8. 活动区块（Act Section）

### 后端接口

| 方法     | 路径                                            | 说明                               |
| -------- | ----------------------------------------------- | ---------------------------------- |
| `GET`    | `/v1/admin/act-sections/list`                   | 活动区块列表（含绑定产品）         |
| `GET`    | `/v1/admin/act-sections/:id`                    | 详情                               |
| `POST`   | `/v1/admin/act-sections/create`                 | 创建区块（title、type、sortOrder） |
| `PATCH`  | `/v1/admin/act-sections/:id`                    | 修改区块信息                       |
| `DELETE` | `/v1/admin/act-sections/:id`                    | 删除区块                           |
| `POST`   | `/v1/admin/act-sections/:id/bind`               | 批量绑定产品到区块                 |
| `DELETE` | `/v1/admin/act-sections/:id/unbind/:treasureId` | 解绑产品                           |

### 关键代码

```
apps/api/src/admin/act-section/

apps/admin-next/src/
  ├── app/(dashboard)/act-sections/page.tsx
  └── views/ActSectionManagement.tsx
      └── views/act-section/ActSectionBindProductModal.tsx
```

---

## 9. Banner 管理

### 后端接口

| 方法     | 路径                          | 说明                                     |
| -------- | ----------------------------- | ---------------------------------------- |
| `GET`    | `/v1/admin/banners/list`      | Banner 列表（含 sortOrder 排序）         |
| `GET`    | `/v1/admin/banners/:id`       | 详情                                     |
| `POST`   | `/v1/admin/banners/create`    | 创建 Banner（image、link、type）         |
| `PATCH`  | `/v1/admin/banners/:id`       | 修改 Banner（支持拖拽后 sortOrder 更新） |
| `PATCH`  | `/v1/admin/banners/:id/state` | 启用/禁用                                |
| `DELETE` | `/v1/admin/banners/:id`       | 删除                                     |

### 关键代码

```
apps/api/src/admin/banner/

apps/admin-next/src/
  ├── app/(dashboard)/banners/page.tsx
  └── views/BannerManagement.tsx
      └── views/banner/BannerModal.tsx
```

---

## 10. 订单管理

### 后端接口

| 方法     | 路径                             | 权限                 | 说明                                        |
| -------- | -------------------------------- | -------------------- | ------------------------------------------- |
| `GET`    | `/v1/admin/order/list`           | `ORDER:view_order`   | 分页查询订单，支持订单号/用户/状态/日期筛选 |
| `GET`    | `/v1/admin/order/:id`            | `ORDER:view_order`   | 订单详情（含物流、退款信息）                |
| `PATCH`  | `/v1/admin/order/:id/status`     | `ORDER:update_order` | 修改订单状态                                |
| `DELETE` | `/v1/admin/order/:id`            | `ORDER:delete_order` | 删除订单                                    |
| `POST`   | `/v1/admin/order/refund/approve` | `ORDER:audit_refund` | 退款审核通过                                |
| `POST`   | `/v1/admin/order/refund/reject`  | `ORDER:audit_refund` | 退款审核拒绝                                |

### 关键代码

```
apps/api/src/admin/order/

apps/admin-next/src/
  ├── app/(dashboard)/orders/page.tsx
  ├── components/orders/OrdersClient.tsx   # URL searchParams 驱动 filter
  └── views/OrderManagement.tsx
      └── views/order/OrderDetailDrawer.tsx
```

### 订单状态流

```
PENDING(1) → PAID(2) → SHIPPING(3) → DELIVERED(4) → COMPLETED(5)
                ↘ CANCELLED(6)
                ↘ REFUND_PENDING(7) → REFUNDED(8)
```

---

## 11. 拼团管理

### 后端接口

| 方法  | 路径                        | 说明                             |
| ----- | --------------------------- | -------------------------------- |
| `GET` | `/v1/admin/groups/list`     | 拼团列表（含团长/参与人数/状态） |
| `GET` | `/v1/admin/groups/:groupId` | 拼团详情（含成员列表）           |

### 关键代码

```
apps/api/src/admin/group/

apps/admin-next/src/
  ├── app/(dashboard)/groups/page.tsx
  └── views/GroupManagement.tsx
```

---

## 12. 营销 / 优惠券

### 后端接口

| 方法     | 路径                       | 权限                        | 说明                                     |
| -------- | -------------------------- | --------------------------- | ---------------------------------------- |
| `GET`    | `/v1/admin/coupons/list`   | `MARKETING:view_activity`   | 优惠券模板列表                           |
| `GET`    | `/v1/admin/coupons/:id`    | `MARKETING:view_activity`   | 模板详情                                 |
| `POST`   | `/v1/admin/coupons/create` | `MARKETING:create_activity` | 创建优惠券（类型/面值/条件/有效期/限量） |
| `PATCH`  | `/v1/admin/coupons/:id`    | `MARKETING:update_activity` | 修改优惠券                               |
| `DELETE` | `/v1/admin/coupons/:id`    | `MARKETING:delete_activity` | 删除优惠券                               |

### 关键代码

```
apps/api/src/admin/coupon/

apps/admin-next/src/
  ├── app/(dashboard)/marketing/page.tsx
  ├── components/marketing/MarketingClient.tsx
  └── views/Marketing.tsx → views/Marketing/Coupon.tsx
      └── views/Marketing/CouponModal.tsx
```

### 优惠券类型

| 类型值          | 说明         |
| --------------- | ------------ |
| `FIXED`         | 固定金额减免 |
| `PERCENT`       | 百分比折扣   |
| `FREE_SHIPPING` | 免运费       |

---

## 13. 财务中心

### 后端接口

| 方法   | 路径                                  | 权限                     | 说明                               |
| ------ | ------------------------------------- | ------------------------ | ---------------------------------- |
| `GET`  | `/v1/admin/finance/transactions`      | `FINANCE:view_finance`   | 钱包流水列表                       |
| `POST` | `/v1/admin/finance/adjust`            | `FINANCE:manual_adjust`  | 人工调账（高危操作，记录操作日志） |
| `GET`  | `/v1/admin/finance/withdrawals`       | `FINANCE:view_finance`   | 提现申请列表                       |
| `GET`  | `/v1/admin/finance/recharges`         | `FINANCE:view_finance`   | 充值记录列表                       |
| `POST` | `/v1/admin/finance/withdrawals/audit` | `FINANCE:audit_withdraw` | 提现审核（通过/拒绝）              |
| `GET`  | `/v1/admin/finance/statistics`        | `FINANCE:view_finance`   | 财务汇总统计                       |
| `POST` | `/v1/admin/finance/recharge/sync/:id` | `FINANCE:audit_recharge` | 充值补单（人工同步）               |

### 关键代码

```
apps/api/src/admin/finance/
  ├── finance.controller.ts
  └── finance.service.ts    # 余额调整须走 Prisma 事务

apps/admin-next/src/
  ├── app/(dashboard)/finance/page.tsx
  ├── views/Finance.tsx                          # Tab: 流水 / 充值 / 提现 / 支付渠道
  ├── views/FinancePage.tsx
  └── views/finance/
      ├── TransactionList.tsx                    # 钱包流水
      ├── WithdrawList.tsx                       # 提现审核列表
      └── RechargeList.tsx                       # 充值记录列表
```

### 重要约定

- 余额字段全部用 `Decimal` 类型存储，API 返回时序列化为 `string` 防精度丢失
- 人工调账必须填写操作原因（`reason`），自动写入 `AdminOperationLog`

---

## 14. 支付渠道管理

### 后端接口

| 方法     | 路径                                     | 权限                             | 说明                           |
| -------- | ---------------------------------------- | -------------------------------- | ------------------------------ |
| `GET`    | `/v1/admin/payment/channels/list`        | `FINANCE:view_payment_channel`   | 渠道列表（含费率/限额/状态）   |
| `POST`   | `/v1/admin/payment/channels/create`      | `FINANCE:create_payment_channel` | 创建渠道                       |
| `PATCH`  | `/v1/admin/payment/channels/:id`         | `FINANCE:update_payment_channel` | 修改渠道（费率/限额/状态切换） |
| `DELETE` | `/v1/admin/payment/channels/:id/:status` | `FINANCE:update_payment_channel` | 禁用渠道（软删除）             |

### 关键代码

```
apps/api/src/admin/payment-channel/

apps/admin-next/src/
  ├── app/(dashboard)/payment-channels/page.tsx
  └── views/PaymentChannelList.tsx
      └── views/payment-channel/PaymentChannelModal.tsx
```

### 渠道字段

| 字段                      | 说明                             |
| ------------------------- | -------------------------------- |
| `type`                    | 1=充值渠道, 2=提现渠道           |
| `code`                    | 唯一标识码（对接第三方支付使用） |
| `minAmount` / `maxAmount` | 单笔限额（₱）                    |
| `feeFixed`                | 固定手续费（₱）                  |
| `feeRate`                 | 比例手续费（0.0~1.0）            |
| `status`                  | 1=正常, 0=禁用, 2=维护中         |

---

## 15. 数据分析仪表板

### 后端接口

| 方法  | 路径                            | 说明                                                                |
| ----- | ------------------------------- | ------------------------------------------------------------------- |
| `GET` | `/v1/admin/stats/overview`      | 汇总统计：用户总数/今日新增、订单数/今日、累计收入/今日、待审核提现 |
| `GET` | `/v1/admin/stats/trend?days=30` | 近 N 天趋势：每日订单量+收入 + 每日新注册用户                       |

### 返回结构

```typescript
// GET /v1/admin/stats/overview
interface StatsOverview {
  users: { total: number; today: number; thisMonth: number };
  orders: { total: number; today: number; paid: number };
  revenue: { total: string; today: string }; // Decimal 字符串
  finance: {
    totalDeposit: string;
    pendingWithdrawCount: number;
    pendingWithdrawAmount: string;
  };
}

// GET /v1/admin/stats/trend
interface StatsTrend {
  orders: Array<{ date: string; count: number; revenue: string }>;
  users: Array<{ date: string; count: number }>;
}
```

### 关键代码

```
apps/api/src/admin/stats/
  ├── stats.controller.ts
  └── stats.service.ts    # 纯 Prisma aggregate 查询，无缓存

apps/admin-next/src/
  ├── app/(dashboard)/analytics/page.tsx          # Server Component
  ├── components/analytics/
  │   ├── AnalyticsOverview.tsx                   # SSR 预取 overview（Suspense streaming）
  │   └── AnalyticsTrendSection.tsx               # Client Component（Recharts 折线图）
  └── api/index.ts → statsApi.getOverview() / getTrend()
```

### SSR 架构

```
analytics/page.tsx (Server Component)
  └── <Suspense fallback={<OverviewSkeleton />}>
        <AnalyticsOverview />         ← serverGet('/v1/admin/stats/overview')
      </Suspense>
  └── <AnalyticsTrendSection />       ← useQuery on client
```

---

## 16. 操作日志审计

### 后端接口

| 方法  | 路径                            | 说明                                                         |
| ----- | ------------------------------- | ------------------------------------------------------------ |
| `GET` | `/v1/admin/operation-logs/list` | 分页查询操作日志，支持 adminId/action/keyword/dateRange 筛选 |

### 请求参数

```typescript
interface QueryOperationLogDto {
  page?: number;
  pageSize?: number;
  adminId?: string; // 按管理员 ID 筛选
  action?: string; // 具体动作，如 "view_user"（'ALL' 表示不限）
  keyword?: string; // 模糊匹配 adminName / details / module
  startDate?: string; // ISO 日期字符串
  endDate?: string;
}
```

### 返回结构

日志记录包含关联的 `admin` 对象（username + realName）。

### 日志写入方式

操作日志通过 `OperationLogService.log()` 在各 Service 内**手动埋点**写入，无 AOP 拦截器，需在高危操作处显式调用：

```typescript
// 示例（finance.service.ts）
await this.operationLogService.log({
  adminId: currentUserId,
  adminName: admin.username,
  module: OpModule.FINANCE,
  action: OpAction.FINANCE.MANUAL_ADJUST,
  details: `调整用户 ${userId} 余额 ${amount}`,
  ip: requestIp,
});
```

### 关键代码

```
apps/api/src/admin/operation-log/
  ├── operation-log.controller.ts
  └── operation-log.service.ts    # getList() 含 OR 关键词搜索 + 关联 admin

apps/admin-next/src/
  ├── app/(dashboard)/operation-logs/page.tsx
  ├── components/operation-logs/OperationLogClient.tsx
  └── views/OperationLogList.tsx
```

> 侧边栏路由: `Operations` 组 → `/operation-logs`（`routes/index.ts` 已注册，翻译键 `operationLogs`）

### 数据模型

```prisma
model AdminOperationLog {
  id        String   @id @default(cuid())
  adminId   String
  admin     AdminUser @relation(fields: [adminId], references: [id])
  adminName String
  module    String   // OpModule 枚举值
  action    String   // OpAction 具体动作
  details   String?
  ip        String?
  createdAt DateTime @default(now())
}
```

---

## 17. 通知 / 推送管理（Firebase FCM）

### 后端接口

| 方法   | 路径                                    | 权限                    | 说明                                            |
| ------ | --------------------------------------- | ----------------------- | ----------------------------------------------- |
| `GET`  | `/v1/admin/notifications/logs`          | `ADMIN` / `SUPER_ADMIN` | 分页查询推送历史，支持类型/关键词/日期筛选      |
| `GET`  | `/v1/admin/notifications/devices/stats` | `ADMIN` / `SUPER_ADMIN` | 设备统计（按平台 + 7天活跃数）                  |
| `POST` | `/v1/admin/notifications/broadcast`     | `ADMIN` / `SUPER_ADMIN` | 全员广播推送（通过 Firebase Topic `all_users`） |
| `POST` | `/v1/admin/notifications/targeted`      | `ADMIN` / `SUPER_ADMIN` | 向指定用户的所有绑定设备推送                    |

### 请求 / 返回结构

```typescript
// POST /v1/admin/notifications/broadcast
interface SendBroadcastPayload {
  title: string;
  body: string;
  extraData?: Record<string, any>;
}

// POST /v1/admin/notifications/targeted
interface SendTargetedPayload {
  targetUserId: string; // 客户端用户 ID
  title: string;
  body: string;
  extraData?: Record<string, any>;
}

// GET /v1/admin/notifications/devices/stats
interface DeviceStats {
  total: number;
  android: number;
  ios: number;
  web: number;
  activeInLast7Days: number;
}

// GET /v1/admin/notifications/logs（分页）
interface AdminPushLog {
  id: string;
  createdAt: string;
  adminId: string;
  adminName: string;
  type: "broadcast" | "targeted";
  targetUserId?: string;
  title: string;
  body: string;
  extraData?: Record<string, any>;
  status: "sent" | "failed";
  successCount: number;
  failureCount: number;
}
```

### 关键代码

```
apps/api/src/admin/notification/
  ├── notification.controller.ts    # 4 个路由
  ├── notification.service.ts       # 调用 client NotificationService 发推送 + 写日志
  └── dto/
      ├── query-push-log.dto.ts
      ├── send-broadcast.dto.ts
      └── send-targeted.dto.ts

apps/api/src/client/notification/
  └── notification.service.ts       # Firebase Admin SDK 封装
      # sendPrivateMessage()    — 多设备 sendEachForMulticast
      # sendBroadcast()         — Topic 消息（all_users）
      # registerDevice()        — FCM Token 上报 + 自动订阅 Topic
      # sendCallWakeUpPush()    — 音视频通话静默唤醒推送

apps/admin-next/src/
  ├── app/(dashboard)/notifications/page.tsx
  └── views/NotificationManagement.tsx
      # Tab 1: 📢 全员广播表单（title + body）
      # Tab 2: 🎯 定向推送表单（targetUserId + title + body）
      # Tab 3: 📋 推送历史列表（类型筛选 + 刷新）
      # 顶部: 设备统计卡片（Total / Android / iOS / Web / 7d Active）
```

### Firebase 初始化机制

```typescript
// onModuleInit() 读取环境变量 FIREBASE_ADMIN_CREDENTIALS（JSON 字符串）
// 若未设置则打印 warn 并跳过，不会导致启动失败
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(firebaseConfig);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
```

### 数据模型

```prisma
model AdminPushLog {
  id           String    @id @default(cuid())
  createdAt    DateTime  @default(now())
  adminId      String    // 操作管理员
  adminName    String
  type         String    // broadcast | targeted
  targetUserId String?   // 定向推送目标用户 ID
  title        String
  body         String
  extraData    Json?
  status       String    // sent | failed
  successCount Int       @default(0)
  failureCount Int       @default(0)
  admin        AdminUser @relation(...)
  @@map("admin_push_logs")
}

// 设备表（FCM Token 为主键）
model Device {
  token      String   @id    // FCM Token
  platform   String          // android | ios | web
  userId     String?         // 绑定用户（退出登录置 null，Token 保留）
  lastActive DateTime        // 用于清洗死粉（超 6 个月不活跃）
  @@map("devices")
}
```

### 推送流程

```
管理员填表 → POST /broadcast
  → AdminNotificationService.sendBroadcast()
    → client.NotificationService.sendBroadcast()   ← Firebase Topic 推送
    → prisma.adminPushLog.create()                  ← 记录推送日志
  → 返回 AdminPushLog

管理员填 userId → POST /targeted
  → AdminNotificationService.sendTargeted()
    → prisma.device.findMany(userId)                ← 查询用户设备 Token
    → client.NotificationService.sendPrivateMessage() ← sendEachForMulticast
    → prisma.adminPushLog.create()
```

### 环境变量

```bash
# deploy/.env.dev 和 deploy/.env.prod 中均已配置
FIREBASE_ADMIN_CREDENTIALS='{"type":"service_account","project_id":"adroit-outlet-444914-m0",...}'
```

> ⚠️ 注意：该变量值为 **完整 JSON 字符串**，不能换行，`private_key` 中的换行用 `\n` 转义。

### 数据库迁移

迁移文件: `apps/api/prisma/migrations/20260316132335_add_admin_push_log/migration.sql`（已生成）

---

## 18. 地区数据（Region）

### 后端接口

| 方法  | 路径                                  | 说明                 |
| ----- | ------------------------------------- | -------------------- |
| `GET` | `/v1/admin/region/provinces`          | 菲律宾省份列表       |
| `GET` | `/v1/admin/region/cities/:provinceId` | 城市列表             |
| `GET` | `/v1/admin/region/barangays/:cityId`  | 乡镇列表（最细粒度） |

> 地区数据用于地址录入时的三级联动下拉。数据从 `Province` / `City` / `Barangay` 表读取，由 seed 脚本初始化。

---

## 19. 客服接待台（IM Chat Moderation）

> **Phase 5-D** | 完成时间：2026-03-16

### 背景 & 设计思路

项目的 IM 模块（`conversations` / `chat_messages` / `chat_members`）已完整运行，客户端 Socket.io 网关负责实时推送。  
Admin 侧只需要**只读查看 + 文字回复 + 关闭工单**，不需要接入 Socket，采用 **HTTP 轮询（10 s）** 即可满足客服场景需求。

Admin 以 **`senderId = null`（系统消息）** 身份回复，前端通过 `isSystem: true` 标志渲染为右侧客服气泡，用户端收到的消息预览格式为 `[AgentName]: 内容`。

### 后端接口

| 方法    | 路径                                        | 权限               | 说明                                                              |
| ------- | ------------------------------------------- | ------------------ | ----------------------------------------------------------------- |
| `GET`   | `/v1/admin/chat/conversations`              | `ADMIN` / `EDITOR` | 客服会话列表，默认筛选 `SUPPORT` 类型，支持 keyword / status 分页 |
| `GET`   | `/v1/admin/chat/conversations/:id/messages` | `ADMIN` / `EDITOR` | 消息历史，游标分页，admin 无权限限制（可看任意成员发的消息）      |
| `POST`  | `/v1/admin/chat/conversations/:id/reply`    | `ADMIN` / `EDITOR` | 客服回复（`senderId=null`，写 `meta.agentName`）                  |
| `POST`  | `/v1/admin/chat/messages/:id/force-recall`  | `ADMIN`            | 强制撤回（无 2 分钟限制）                                         |
| `PATCH` | `/v1/admin/chat/conversations/:id/close`    | `ADMIN` / `EDITOR` | 关闭会话，写入 `type=99` 系统消息，`status` 置 2                  |

### 请求 / 返回结构

```typescript
// GET /v1/admin/chat/conversations
interface QueryConversationsParams {
  page?: number;
  pageSize?: number;
  type?: "GROUP" | "DIRECT" | "SUPPORT" | "BUSINESS"; // 默认 SUPPORT
  keyword?: string; // 模糊匹配会话名 / 成员昵称
  status?: number; // 1=正常 2=已关闭
}

// 返回列表项
interface ChatConversation {
  id: string;
  type: string;
  name: string | null;
  status: number; // 1=Active 2=Closed
  lastMsgContent: string | null;
  lastMsgTime: number; // 毫秒时间戳
  lastMsgSeqId: number;
  memberCount: number;
  members: Array<{
    userId: string;
    nickname: string | null;
    avatar: string | null;
    role: string;
  }>;
}

// GET /v1/admin/chat/conversations/:id/messages 返回
interface ChatMessagesResult {
  list: ChatMessage[];
  nextCursor: number | null; // 下一页游标（seqId），null=无更多
  totalSeqId: number;
}

interface ChatMessage {
  id: string;
  seqId: number;
  content: string;
  type: number; // 0=text 1=image 2=audio 3=video 99=system
  isRecalled: boolean;
  createdAt: number; // 毫秒时间戳
  meta: Record<string, any> | null;
  senderId: string | null;
  sender: { id: string; nickname: string; avatar: string | null } | null;
  isSystem: boolean; // senderId === null
}

// POST /v1/admin/chat/conversations/:id/reply
interface AdminReplyPayload {
  content: string;
  agentName?: string; // 客服标签，默认取 JWT 中 username
}

// PATCH /v1/admin/chat/conversations/:id/close
interface CloseConversationPayload {
  reason?: string; // 默认 'Closed by support agent'
}
```

### 关键代码

```
apps/api/src/admin/chat/
  ├── admin-chat.module.ts       # 模块（仅依赖 PrismaModule）
  ├── admin-chat.service.ts      # 5 个方法，使用 Prisma.XxxWhereInput 强类型
  ├── admin-chat.controller.ts   # AdminJwtAuthGuard + RolesGuard
  └── dto/
      ├── query-conversations.dto.ts
      └── admin-chat.dto.ts      # QueryMessagesDto / AdminReplyDto / CloseConversationDto

apps/admin-next/src/
  ├── app/(dashboard)/customer-service/page.tsx # Server Component 包装
  ├── views/CustomerServiceDesk.tsx         # 完整客服接待台（'use client'）
  ├── api/index.ts → chatApi                # 5 个 API 方法
  └── type/types.ts → ChatConversation / ChatMessage / ChatMessagesResult
```

### 前端 UI 结构

```
CustomerServiceDesk（'use client'）
  ├── 左侧面板（w-80）
  │   ├── 搜索框（keyword 过滤）
  │   ├── 状态标签（All / Active / Closed）
  │   ├── 会话列表（ConversationItem × n）
  │   │   └── 用户头像 + 昵称 + 最后消息预览 + 时间 + 状态徽章
  │   └── 分页（total > 30 时显示）
  └── 右侧面板（flex-1）
      └── ChatWindow（key=conv.id，切换会话重置状态）
          ├── 顶栏：用户信息 + StatusBadge + Close Ticket 按钮 + 刷新按钮
          ├── 消息区（overflow-y-auto）
          │   ├── "Load earlier messages"（游标向上翻页）
          │   ├── MessageBubble × n
          │   │   ├── type=99（系统）→ 居中灰色胶囊
          │   │   ├── isSystem=true → 右侧青色气泡（客服）
          │   │   └── isSystem=false → 左侧白色气泡（用户）
          │   └── 滚动锚点 div（新消息自动滚底）
          └── 回复栏
              ├── textarea（Enter 发送 / Shift+Enter 换行）
              └── 发送按钮（POST /reply）
```

### 轮询机制

| 位置     | 间隔 | 说明                                                                        |
| -------- | ---- | --------------------------------------------------------------------------- |
| 会话列表 | 15 s | `useRequest` `pollingInterval: 15000`，刷新左侧未读状态                     |
| 消息区   | 10 s | `useRequest` `pollingInterval: 10000`，用最新一页覆盖（不影响已加载的历史） |

### 消息写入机制

```typescript
// admin-chat.service.ts — replyToConversation()
// 1. 事务内更新 conversation.lastMsgSeqId += 1
// 2. 创建 ChatMessage：senderId: null（系统身份）
//    meta: { agentName: 'AdminUsername', isSupport: true }
// 3. 自动将已关闭（status=2）的会话重新激活（status=1）

// 关闭会话：type=99 系统消息，内容为 reason
// meta: { closedBy: adminName, isClose: true }
```

### 路由 & 导航

```
侧边栏路由: Customer Service 组 → /customer-service（MessageSquare 图标）
翻译键: customerService → "Customer Service"（en）/ "客服接待台"（zh）
```

### 与客户端 Socket 的关系

- Admin **不接入** Socket.io Gateway，避免复杂度
- 用户发消息 → Socket 推给其他在线客户端 → Admin 侧 10 s 轮询自动刷新
- Admin 回复 → HTTP POST 写数据库 → 下次用户端拉消息或收到 Socket 推送时看到

---

## 20. 客服渠道管理（Support Channels）

> **Phase 6-IM Phase 2** | 完成时间：2026-03-20

### 能力概述

- 支持后台为不同业务线创建多个客服渠道（每渠道对应一个 bot 用户）
- 支持渠道启停，停用后不再用于新会话建联
- 默认客服会话类型统一为 `SUPPORT`，避免混用历史 `BUSINESS` 共享群逻辑

### 后端接口

| 方法    | 路径                                    | 权限               | 说明                                |
| ------- | --------------------------------------- | ------------------ | ----------------------------------- |
| `GET`   | `/v1/admin/support-channels/list`       | `ADMIN` / `EDITOR` | 渠道列表（含业务 ID、bot、状态）    |
| `POST`  | `/v1/admin/support-channels/create`     | `ADMIN`            | 创建渠道（事务内自动创建 bot 用户） |
| `PATCH` | `/v1/admin/support-channels/:id`        | `ADMIN`            | 编辑渠道信息                        |
| `PATCH` | `/v1/admin/support-channels/:id/status` | `ADMIN`            | 启用/停用渠道                       |

### 关键代码

```
apps/api/src/admin/support-channel/
  ├── support-channel.controller.ts
  ├── support-channel.service.ts
  └── dto/

apps/api/src/common/chat/chat.service.ts
  # addMemberToBusinessGroup() 已重构为 SUPPORT 1v1 建联（按 SupportChannel 找 bot）

apps/admin-next/src/
  ├── app/(dashboard)/support-channels/page.tsx
  ├── views/SupportChannels.tsx
  └── api/index.ts → supportChannelApi
```

### 数据模型

```prisma
model SupportChannel {
  id         String   @id      // 业务标识（businessId）
  botUserId  String   @unique
  isActive   Boolean  @default(true)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}
```

---

## 附录 A：前端公共组件速查

| 组件                              | 位置                                       | 用途                                           |
| --------------------------------- | ------------------------------------------ | ---------------------------------------------- |
| `PageHeader`                      | `components/scaffold/PageHeader.tsx`       | 页面标题 + 描述 + 操作按钮                     |
| `BaseTable`                       | `components/scaffold/BaseTable.tsx`        | react-table v8 封装，接受 `ColumnDef<T>[]`     |
| `SchemaSearchForm`                | `components/scaffold/SchemaSearchForm.tsx` | JSON Schema 驱动的搜索表单                     |
| `SmartTable`                      | `components/scaffold/SmartTable/`          | ProTable 风格，内置搜索+分页（`useAntdTable`） |
| `Modal` / `Button` / `Badge` etc. | `components/UIComponents.tsx`              | 基础 UI 组件                                   |
| `ModalManager`                    | `@repo/ui`                                 | 命令式弹窗（`ModalManager.open()`）            |

---

## 附录 B：API 客户端速查

所有 API 方法统一在 `apps/admin-next/src/api/index.ts` 中定义：

```typescript
userApi; // 后台管理员 CRUD
clientUserApi; // 客户端用户管理
orderApi; // 订单管理
productApi; // 产品（treasure）管理
categoryApi; // 分类管理
bannerApi; // Banner 管理
couponApi; // 优惠券管理
financeApi; // 财务（流水/充值/提现/统计）
paymentChannelApi; // 支付渠道
kycApi; // KYC 审核
actSectionApi; // Act Section
groupApi; // 拼团
addressApi; // 地址
regionApi; // 地区（省市区）
statsApi; // 数据统计
adminOperationLogApi; // 操作日志
rolesApi; // 角色权限汇总
notificationApi; // 推送通知（广播/定向/日志/设备统计）
chatApi; // 客服 IM（会话列表/消息历史/回复/撤回/关闭）
supportChannelApi; // 客服渠道（列表/创建/编辑/启停）
uploadApi; // 文件上传
```

---

## 附录 C：共享常量速查（`@lucky/shared`）

```typescript
// 角色
Role; // SUPER_ADMIN | ADMIN | EDITOR | VIEWER | FINANCE
RolePermissions; // 各角色权限字符串数组
RoleDescriptions; // 角色 en/zh 名称 + 描述

// 操作日志
OpModule; // user_management | order_management | ...
OpAction; // USER.VIEW | FINANCE.WITHDRAW_AUDIT | ...
OpModuleLabel; // 中文模块名映射

// 业务枚举
TRANSACTION_TYPE; // 流水类型（1-8）
TRANSACTION_TYPE_LABEL;
BALANCE_TYPE; // 1=现金, 2=金币
ADMIN_USER_STATUS; // 1=active, 0=inactive
ORDER_STATUS; // 订单状态
ORDER_STATUS_LABEL;
KycStatus; // KYC 状态
```
