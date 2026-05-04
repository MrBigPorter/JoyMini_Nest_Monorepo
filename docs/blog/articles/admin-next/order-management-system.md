---
title: "admin-next 订单管理系统——9 种状态流转 + 退款审核 + 权限管控"
slug: "order-management-system"
date: "2026-05-03"
description: "深度解析 admin-next 订单管理系统：Order 模型 32 字段设计、9 种状态枚举与流转限制、useAntdTable 分页搜索、退款审批事务（钱包扣减 + 金币退回）、单元测试覆盖，涵盖前后端完整链路"
tags: ["admin-next", "NestJS", "order-management", "refund", "Prisma", "permissions", "wallet", "swagger"]
---

# admin-next 订单管理系统——9 种状态流转 + 退款审核 + 权限管控

## 1. 架构全景

订单管理是 admin-next 后台的核心模块之一，负责查看、搜索、更新状态、发货、删除以及退款审批等操作。系统采用 **前后端分离 + 权限精细化管控** 架构：

- **前端页面**: [`apps/admin-next/src/views/OrderManagement.tsx`](apps/admin-next/src/views/OrderManagement.tsx)
- **后端 API**: [`apps/api/src/admin/order/`](apps/api/src/admin/order/)
- **数据库模型**: [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma) — `Order` 模型

```
┌──────────────────────────────────────────────────────────────────────────┐
│  admin-next (Next.js)                                                    │
│                                                                           │
│  OrderManagement.tsx                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │  PageHeader (Order Management)                                       │  │
│  │                                                                       │  │
│  │  ┌─ SchemaSearchForm ────────────────────────────────────────────┐   │  │
│  │  │  Search Input (orderNo/nickname/phone)  |  Status Filter (9)  │   │  │
│  │  └───────────────────────────────────────────────────────────────┘   │  │
│  │                                                                       │  │
│  │  ┌─ BaseTable (TanStack Table) ───────────────────────────────────┐  │  │
│  │  │  Order No. | Date | Customer | Product | Total | Status | Action │  │
│  │  │  ───────────────────────────────────────────────────────────── │  │  │
│  │  │  ORD-001  | 05/01 | Alice  | Treasure | ₱500 | ✅ Paid  | 👁  │  │  │
│  │  │  ORD-002  | 04/30 | Bob    | Box      | ₱200 | 🚚 Shipped| 👁  │  │  │
│  │  │  ...                                                             │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                           │
│  ┌─ Modal Details ────────────────────────────────────────────────────┐  │
│  │  Status: ✅ Paid                                                    │  │
│  │  Customer: Alice (phone)   |   Product: Treasure (₱500)             │  │
│  │  [Ship Order] [Cancel Order]                                        │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                           │
│  ┌─ Shipping Modal ───────────────────────────────────────────────────┐  │
│  │  Courier: Input | Tracking: Input | [Confirm Shipment]              │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
                       │ HTTP
                       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  NestJS API (apps/api/src/admin/order/)                                  │
│                                                                           │
│  OrderController (6 endpoints)                                            │
│  ├─ GET    /admin/order/list        ← 分页列表 + 关键词搜索              │
│  ├─ GET    /admin/order/:id         ← 订单详情                          │
│  ├─ PATCH  /admin/order/:id/status  ← 更新状态 (限 4 种)               │
│  ├─ DELETE /admin/order/:id         ← 删除订单 (仅取消/已退款可删)      │
│  ├─ POST   /admin/order/refund/approve  ← 审批退款 (事务 + 钱包回调)   │
│  └─ POST   /admin/order/refund/reject   ← 拒绝退款 (记录原因)           │
│                                                                           │
│  OrderService                                                             │
│  ├─ findAll()      → Prisma 动态查询                                     │
│  ├─ finOne()       → 含 user + treasure + group 关联                     │
│  ├─ updateStatus() → 状态校验 + 更新                                     │
│  ├─ remove()       → 仅 CANCELED / REFUNDED 可删                        │
│  ├─ approveRefundByAdmin() → $transaction + WalletService                │
│  └─ rejectRefundByAdmin()  → 更新 refundStatus = REFUND_FAILED           │
│                                                                           │
│  Guards: JwtAuthGuard + PermissionsGuard                                  │
│  Permissions: ORDER.VIEW / ORDER.UPDATE / ORDER.DELETE                    │
└──────────────────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Prisma Database                                                         │
│  Order (32 字段)                                                         │
│  ├─ orderId / orderNo (唯一)                                             │
│  ├─ userId → User                                                        │
│  ├─ treasureId → Treasure                                                │
│  ├─ 金额: originalAmount / discountAmount / couponAmount /               │
│  │        coinAmount / finalAmount / unitPrice                           │
│  ├─ 状态: orderStatus (9 种) / payStatus / refundStatus / shippingStatus │
│  ├─ 物流: logisticsCo / trackingNo / shippingAddress (JSON)              │
│  ├─ 退款: refundAmount / refundReason / refundedAt / refundAppliedBy     │
│  │        refundAuditedBy / refundRejectReason                           │
│  ├─ 支付: paymentMethod / transactionId / paidAt                         │
│  └─ 关联: groupId → TreasureGroup / userCouponId / flashSaleProductId    │
│  └─ 索引: [userId], [treasureId], [orderStatus, payStatus]               │
└──────────────────────────────────────────────────────────────────────────┘
```

## 2. 数据库设计

### 2.1 Order 模型

[`Order`](apps/api/prisma/schema.prisma:734) 模型采用 32 个字段覆盖订单全生命周期：

```prisma
model Order {
  orderId            String    @id @default(cuid()) @map("order_id")
  orderNo            String    @unique @map("order_no")         // 订单号（唯一）
  userId             String    @map("user_id")                  // 用户 ID
  treasureId         String    @map("treasure_id")              // 商品 ID

  // ── 金额体系（Decimal 精确计算）──
  originalAmount     Decimal   @map("original_amount")          // 原价
  discountAmount     Decimal   @map("discount_amount")          // 折扣金额
  couponAmount       Decimal   @map("coupon_amount")            // 优惠券抵扣
  coinAmount         Decimal   @map("coin_amount")              // 金币抵扣
  finalAmount        Decimal   @map("final_amount")             // 实付金额
  unitPrice          Decimal   @map("unit_price")               // 单价
  buyQuantity        Int       @map("buy_quantity")             // 数量

  // ── 状态体系 ──
  orderStatus        Int       @default(1) @map("order_status") // 订单状态 (1-9)
  payStatus          Int       @default(0) @map("pay_status")   // 支付状态
  refundStatus       Int       @default(0) @map("refund_status")// 退款状态
  shippingStatus     Int       @default(0) @map("shipping_status") // 发货状态

  // ── 物流信息 ──
  logisticsCo        String?   @map("logistics_co")             // 物流公司
  trackingNo         String?   @map("tracking_no")              // 运单号
  shippingAddress    Json?     @map("shipping_address")         // 地址（JSON）

  // ── 退款信息 ──
  refundAmount       Decimal?  @map("refund_amount")
  refundReason       String?   @map("refund_reason")
  refundedAt         DateTime? @map("refunded_at")
  refundAppliedBy    String?   @map("refund_applied_by")        // 申请人
  refundAuditedBy    String?   @map("refund_audited_by")        // 审批人
  refundRejectReason String?   @map("refund_reject_reason")     // 拒绝原因

  // ── 支付信息 ──
  paymentMethod      Int?      @map("payment_method")           // 支付方式
  transactionId      String?   @map("transaction_id")           // 三方流水号
  paidAt             DateTime? @map("paid_at")

  // ── 关联 ──
  groupId            String?   @map("group_id")                 // 拼团 ID
  userCouponId       String?   @unique @map("user_coupon_id")   // 优惠券实例
  flashSaleProductId String?   @map("flash_sale_product_id")    // 秒杀商品
  coinUsed           Decimal   @default(0) @map("coin_used")    // 已使用金币
  hasBonus           Int       @default(0) @map("has_bonus")    // 是否有赠品
  isGroupOwner       Int       @default(0) @map("is_group_owner") // 是否拼团主

  // ── 关系 ──
  user               User      @relation(fields: [userId], references: [id])
  treasure           Treasure  @relation(fields: [treasureId], references: [treasureId])

  createdAt          DateTime  @default(now()) @map("created_at")
  updatedAt          DateTime  @updatedAt @map("updated_at")

  @@index([userId])
  @@index([treasureId])
  @@index([orderStatus, payStatus])
  @@index([groupId])
  @@map("orders")
}
```

### 2.2 状态枚举

订单状态（`orderStatus`）定义了 9 个值，来自 `@lucky/shared` 的 [`ORDER_STATUS`](packages/shared/src/constants/order.ts) 枚举：

| 值 | 常量名 | 含义 | 可操作 |
|----|--------|------|--------|
| 1 | PENDING_PAYMENT | 待支付 | 取消、支付 |
| 2 | PROCESSING_PAYMENT | 支付中 | - |
| 3 | PAID | 已支付/待发货 | 取消、发货、退款 |
| 4 | CANCELED | 已取消 | 删除 |
| 5 | REFUNDED | 已退款 | 删除 |
| 6 | WAIT_GROUP | 待成团 | - |
| 7 | WAIT_DELIVERY | 待发货 (Ready to Ship) | 发货 |
| 8 | SHIPPED | 已发货 | 标记完成 |
| 9 | COMPLETED | 已完成 | - |

**Admin 可手动变更的状态**（`UpdateOrderStatusDto` 通过 `@IsIn()` 校验）：

```typescript
const ADMIN_SETTABLE_STATUSES = [
  ORDER_STATUS.CANCELED,   // 4 — 取消
  ORDER_STATUS.REFUNDED,   // 5 — 退款
  ORDER_STATUS.SHIPPED,    // 8 — 已发货
  ORDER_STATUS.COMPLETED,  // 9 — 已完成
] as const;
```

## 3. 前端页面详解

### 3.1 页面组件

[`OrderManagement.tsx`](apps/admin-next/src/views/OrderManagement.tsx:19) 是 admin-next 标准的列表页面，使用以下技术栈：

| 技术 | 用途 |
|------|------|
| `useAntdTable` (ahooks) | 自动管理分页状态、搜索表单联动 |
| `useRequest` (ahooks) | 手动触发 API 调用（更新、删除） |
| `@tanstack/react-table` | 表格列定义与渲染 |
| `SchemaSearchForm` | 搜索表单（关键字 + 状态下拉） |
| `BaseTable` | 统一表格组件 |
| `ModalManager` (`@repo/ui`) | 弹窗管理（详情、发货、删除确认） |
| `ORDER_STATUS_COLORS` | 状态颜色映射 |

### 3.2 数据获取

使用 `useAntdTable` 实现搜索与分页一体化：

```typescript
const getTableData = async (
  { current, pageSize }: { current: number; pageSize: number },
  formData: OrderSearchForm,
) => {
  const params: OrderListParams = { page: current, pageSize };
  if (formData?.keyword) params.keyword = formData.keyword;
  if (formData?.orderStatus && formData?.orderStatus !== 'All')
    params.orderStatus = Number(formData.orderStatus);

  const res = await orderApi.getList(params);
  return { list: res.list, total: res.total };
};

const { tableProps, run, refresh, search: { reset } } = useAntdTable(
  getTableData,
  {
    defaultPageSize: 10,
    defaultParams: [
      { current: 1, pageSize: 10 },
      { keyword: '', orderStatus: 'All' },
    ],
  },
);
```

`useAntdTable` 的优势：
- 自动管理 `current` 和 `pageSize` 状态
- 搜索表单提交时自动重置到第一页
- 通过 `refresh()` 手动刷新表格数据

### 3.3 搜索表单

通过 [`SchemaSearchForm`](apps/admin-next/src/components/scaffold/SchemaSearchForm.tsx) 声明式定义：

```typescript
<SchemaSearchForm<OrderSearchForm>
  schema={[
    {
      type: 'input',
      key: 'keyword',
      label: 'Search',
      placeholder: 'Order No, Nickname, Phone',
    },
    {
      type: 'select',
      key: 'orderStatus',
      label: 'Status',
      defaultValue: 'All',
      options: [
        { label: 'All', value: 'All' },
        ...Object.entries(ORDER_STATUS_LABEL).map(([k, v]) => ({
          label: v,
          value: k,
        })),
      ],
    },
  ]}
  onSearch={(v) => run({ current: 1, pageSize: 10 }, v)}
  onReset={reset}
/>
```

### 3.4 表格列配置

使用 `@tanstack/react-table` 的 `createColumnHelper` 强类型定义列：

```typescript
const columns = useMemo(() => {
  const columnsHelper = createColumnHelper<Order>();
  return [
    columnsHelper.accessor('orderNo', {
      header: 'Order No.',
      cell: (info) => <span className="font-medium">{info.getValue()}</span>,
    }),
    columnsHelper.accessor('createdAt', {
      header: 'Date',
      cell: (info) => (
        <span className="text-gray-500 text-xs">
          {dayjs(info.getValue()).format('YYYY-MM-DD HH:mm')}
        </span>
      ),
    }),
    columnsHelper.accessor('user.nickname', {
      header: 'Customer',
      cell: (info) => (
        <div className="flex flex-col">
          <span>{info.getValue()}</span>
          <span className="text-xs text-gray-400">
            {info.row.original.user.phone}
          </span>
        </div>
      ),
    }),
    columnsHelper.accessor('treasure.treasureName', {
      header: 'Product',
    }),
    columnsHelper.accessor('originalAmount', {
      header: 'Total',
      cell: (info) => (
        <span className="font-mono font-bold">
          ₱{info.getValue().toLocaleString()}
        </span>
      ),
    }),
    columnsHelper.accessor('orderStatus', {
      header: 'Status',
      cell: (info) => {
        const status = info.getValue();
        const color = ORDER_STATUS_COLORS[status] || 'gray';
        return <Badge color={color}>{ORDER_STATUS_LABEL[status]}</Badge>;
      },
    }),
    columnsHelper.display({
      id: 'actions',
      header: 'Actions',
      cell: (info) => (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => handleOrderDetails(info.row.original)}>
            <Eye size={16} />
          </Button>
          {/* 仅已取消/已退款可删除 */}
          {[ORDER_STATUS.CANCELED, ORDER_STATUS.REFUNDED].includes(
            info.row.original.orderStatus,
          ) && (
            <Button size="sm" variant="ghost" className="text-red-500 hover:bg-red-50"
              onClick={() => handleDelete(info.row.original.orderId)}>
              <Trash2 size={16} />
            </Button>
          )}
        </div>
      ),
    }),
  ];
}, [handleDelete, handleOrderDetails]);
```

**状态颜色映射**（[`ORDER_STATUS_COLORS`](apps/admin-next/src/consts/index.ts:3)）：

```typescript
export const ORDER_STATUS_COLORS = {
  [ORDER_STATUS.PENDING_PAYMENT]: 'yellow',  // 1 待支付
  [ORDER_STATUS.PROCESSING_PAYMENT]: 'blue',  // 2 支付中
  [ORDER_STATUS.PAID]: 'green',             // 3 已支付
  [ORDER_STATUS.CANCELED]: 'gray',           // 4 已取消
  [ORDER_STATUS.REFUNDED]: 'red',            // 5 已退款
  [ORDER_STATUS.WAIT_GROUP]: 'purple',       // 6 待成团
  [ORDER_STATUS.WAIT_DELIVERY]: 'blue',      // 7 待发货
  [ORDER_STATUS.SHIPPED]: 'green',           // 8 已发货
  [ORDER_STATUS.COMPLETED]: 'green',         // 9 已完成
} as const;
```

### 3.5 交互操作

#### 订单详情

通过 `ModalManager.open()` 打开详情弹窗，展示客户信息 + 订单信息 + 条件性操作按钮：

```typescript
const handleOrderDetails = useCallback((data: Order) => {
  ModalManager.open({
    title: `Order Details: ${data.orderNo}`,
    size: 'lg',
    renderChildren: ({ close }) => (
      <div className="space-y-6">
        {/* 状态 Banner */}
        <h3 className="font-bold text-lg">Status: {ORDER_STATUS_LABEL[data.orderStatus]}</h3>

        {/* 双栏信息 */}
        <div className="grid grid-cols-2 gap-4">
          <div>Customer: {data.user.nickname} / {data.user.phone}</div>
          <div>Product: {data.treasure.treasureName} / ₱{data.originalAmount}</div>
        </div>

        {/* 条件性按钮 */}
        <div className="flex justify-end gap-3">
          {data.orderStatus === ORDER_STATUS.PAID && (
            <Button onClick={() => { close(); openShippingModal(data.orderId); }}>
              <Truck size={16} /> Ship Order
            </Button>
          )}
          {[ORDER_STATUS.PENDING_PAYMENT, ORDER_STATUS.PAID].includes(data.orderStatus) && (
            <Button onClick={() => handleUpdateStatus(data.orderId, ORDER_STATUS.CANCELED)}>
              <XCircle size={16} /> Cancel Order
            </Button>
          )}
        </div>
      </div>
    ),
  });
}, [handleUpdateStatus, openShippingModal]);
```

#### 发货弹窗

```typescript
const openShippingModal = useCallback((orderId: string) => {
  ModalManager.open({
    title: 'Ship Order',
    renderChildren: ({ close }) => (
      <div className="space-y-4">
        <Input placeholder="Courier Name" disabled />
        <Input placeholder="Tracking Number" disabled />
        <p className="text-xs text-gray-500">...Confirm will mark the order as shipped.</p>
        <Button onClick={() => { void handleUpdateStatus(orderId, ORDER_STATUS.SHIPPED); close(); }}>
          Confirm Shipment
        </Button>
      </div>
    ),
  });
}, [handleUpdateStatus]);
```

#### 删除确认

仅对 `CANCELED`（已取消）和 `REFUNDED`（已退款）状态的订单显示删除按钮，点击后弹出确认对话框：

```typescript
const handleDelete = useCallback((orderId: string) => {
  ModalManager.open({
    title: 'Confirm Deletion',
    renderChildren: ({ close }) => (
      <div className="space-y-4">
        <p>Are you sure you want to delete this order? This action cannot be undone.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button onClick={async () => {
            await deleteOrderApi(orderId);
            addToast('success', 'Order deleted successfully');
            refresh();
            close();
          }}>Delete</Button>
        </div>
      </div>
    ),
  });
}, [addToast, deleteOrderApi, refresh]);
```

## 4. 后端 API 详解

### 4.1 分页列表 + 搜索

```http
GET /v1/admin/order/list?page=1&pageSize=10&keyword=Alice&orderStatus=3
```

[`OrderService.findAll()`](apps/api/src/admin/order/order.service.ts:31) 使用 Prisma 动态 `where` 构建查询条件：

```typescript
async findAll(dto: QueryOrderDto) {
  const { page = 1, pageSize = 10, keyword, orderStatus } = dto;
  const whereConditions: Prisma.OrderWhereInput = {};

  if (orderStatus) {
    whereConditions.orderStatus = orderStatus;
  }

  if (keyword) {
    whereConditions.OR = [
      { orderNo: { contains: keyword, mode: 'insensitive' } },
      { user: { nickname: { contains: keyword, mode: 'insensitive' } } },
      { user: { phone: { contains: keyword } } },
    ];
  }

  const [total, list] = await this.prismaService.$transaction([
    this.prismaService.order.count({ where: whereConditions }),
    this.prismaService.order.findMany({
      where: whereConditions,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
      include: { user: true, treasure: true },
    }),
  ]);

  return { total, list, page, pageSize };
}
```

### 4.2 更新状态

```http
PATCH /v1/admin/order/:id/status
Content-Type: application/json

{ "status": 8 }
```

[`OrderService.updateStatus()`](apps/api/src/admin/order/order.service.ts:103) 包含状态校验逻辑：

```typescript
async updateStatus(id: string, status: number) {
  const order = await this.finOne(id);

  // 已退款的订单不可再修改
  if (order.orderStatus === ORDER_STATUS.REFUNDED) {
    throw new BadRequestException('Order has already been refunded');
  }

  return this.prismaService.order.update({
    where: { orderId: id },
    data: { orderStatus: status },
    include: { user: true, treasure: true, group: true },
  });
}
```

### 4.3 删除订单

```http
DELETE /v1/admin/order/:id
```

[`OrderService.remove()`](apps/api/src/admin/order/order.service.ts:135) 严格限制可删除状态：

```typescript
async remove(id: string) {
  const order = await this.finOne(id);
  if (!order) throw new NotFoundException(`Order with ID ${id} not found`);

  if (order.orderStatus !== ORDER_STATUS.CANCELED &&
      order.orderStatus !== ORDER_STATUS.REFUNDED) {
    throw new BadRequestException('Only canceled or refunded orders can be deleted');
  }

  return this.prismaService.order.delete({ where: { orderId: id } });
}
```

### 4.4 退款审批（核心事务）

退款审批是最复杂的操作，涉及 **Prisma 事务 + 钱包回调**。

#### 审批通过

[`OrderService.approveRefundByAdmin()`](apps/api/src/admin/order/order.service.ts:165)：

```typescript
async approveRefundByAdmin(adminId: string, orderId: string) {
  return this.prismaService.$transaction(async (ctx) => {
    const order = await this.finOne(orderId);
    if (order.refundStatus !== REFUND_STATUS.REFUNDING) {
      throw new BadRequestException('Order is not waiting for approval');
    }

    const isBalancePay = !order.paymentMethod || order.paymentMethod === PaymentMethod.BALANCE;

    if (isBalancePay) {
      // 1. 退现金
      if (Number(order.finalAmount) > 0) {
        await this.walletService.creditCash({
          userId: order.userId,
          amount: order.finalAmount,
          related: { id: order.orderId, type: 'ORDER' },
          desc: `Refund for order ${order.orderNo} approved by admin ${adminId}`,
          type: TRANSACTION_TYPE.REFUND,
        }, ctx);
      }

      // 2. 退金币
      if (Number(order.coinUsed) > 0) {
        await this.walletService.creditCoin({
          userId: order.userId,
          coins: order.coinUsed,
          related: { id: order.orderId, type: 'ORDER' },
          desc: `Coin refund for order ${order.orderNo} approved by admin ${adminId}`,
          type: TRANSACTION_TYPE.REFUND,
        }, ctx);
      }

      // 3. 更新订单状态
      return ctx.order.update({
        where: { orderId },
        data: {
          orderStatus: ORDER_STATUS.REFUNDED,
          refundStatus: REFUND_STATUS.REFUNDED,
          refundAuditedBy: adminId,
          refundedAt: new Date(),
          refundAmount: order.finalAmount,
        },
      });
    }
  });
}
```

**事务关键点**：
- 使用 `$transaction` 保证 退余额 + 退金币 + 改状态 原子性
- `WalletService.creditCash()` 和 `creditCoin()` 接收 `Prisma.TransactionClient` 参数，共享同一事务上下文
- 如果任一步骤失败，整个事务回滚

#### 审批拒绝

[`OrderService.rejectRefundByAdmin()`](apps/api/src/admin/order/order.service.ts:234) 不涉及钱包操作，只需更新状态和记录拒绝原因：

```typescript
async rejectRefundByAdmin(adminId: string, dto: RefundAuditDto) {
  const order = await this.prismaService.order.findUnique({ where: { orderId: dto.orderId } });
  if (order.refundStatus !== REFUND_STATUS.REFUNDING) {
    throw new BadRequestException('Order is not waiting for approval.');
  }

  return this.prismaService.order.update({
    where: { orderId: dto.orderId },
    data: {
      refundStatus: REFUND_STATUS.REFUND_FAILED, // 3
      refundRejectReason: dto.rejectReason,
      refundAuditedBy: adminId,
      // orderStatus 保持 PAID (3) 不变
    },
  });
}
```

### 4.5 Response DTO

[`OrderResponseDto`](apps/api/src/admin/order/dto/order-response.dto.ts) 使用 `class-transformer` 的 `@Exclude()` / `@Expose()` 控制序列化：

```typescript
@Exclude()
export class OrderResponseDto {
  @Expose() orderId!: string;
  @Expose() orderNo!: string;

  @Expose()
  @DecimalToString()
  originalAmount!: string;  // Decimal → String 避免精度损失

  @Expose()
  @DateToTimestamp()
  createdAt!: number;       // DateTime → Unix Timestamp

  @Expose()
  @Type(() => OrderUserDto)
  user!: OrderUserDto;      // 嵌套 DTO

  @Expose()
  @Type(() => OrderTreasureDto)
  treasure!: OrderTreasureDto;
}
```

## 5. 权限管控

系统使用 **双守卫 + 权限装饰器** 实现精细化权限控制：

| API | 所需权限 | 说明 |
|-----|---------|------|
| `GET /list` | `ORDER.VIEW` | 查看订单列表 |
| `GET /:id` | `ORDER.VIEW` | 查看订单详情 |
| `PATCH /:id/status` | `ORDER.UPDATE` | 更新订单状态 |
| `DELETE /:id` | `ORDER.DELETE` | 删除订单 |
| `POST /refund/approve` | `ORDER.UPDATE` | 审批退款 |
| `POST /refund/reject` | `ORDER.UPDATE` | 拒绝退款 |

实现方式：

```typescript
@Controller('admin/order')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OrderController {
  @Get('list')
  @RequirePermission(OpModule.ORDER, OpAction.ORDER.VIEW)
  async findAll(@Query() query: QueryOrderDto) { ... }

  @Patch(':id/status')
  @RequirePermission(OpModule.ORDER, OpAction.ORDER.UPDATE)
  async updateStatus(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto) { ... }
}
```

Swagger 文档自动生成（`@ApiTags`、`@ApiBearerAuth`、`@ApiOkResponse`）：

```typescript
@ApiTags('Admin Order Management')
@ApiBearerAuth()
@ApiOkResponse({ type: OrderResponseDto })
```

## 6. 状态流转图

```
                   ┌──────────────┐
                   │ PENDING(1)   │──→ CANCELED(4)
                   │ 待支付        │
                   └──────┬───────┘
                          │ 支付
                          ▼
                   ┌──────────────┐
              ┌───→│ PAID(3)      │──→ CANCELED(4)
              │    │ 已支付/待发货 │
              │    └──────┬───────┘
              │           │ 发货
              │           ▼
              │    ┌──────────────┐
              │    │ SHIPPED(8)   │──→ COMPLETED(9)
              │    │ 已发货        │
              │    └──────────────┘
              │
              │    退款申请
              │    ┌──────────────┐
              ├───→│ REFUNDING    │
              │    │ (refundStatus │
              │    │  =1)         │
              │    └──┬───────┬───┘
              │       │       │
              │   审批通过  审批拒绝
              │       ▼       ▼
              │  ┌────────┐ ┌────────┐
              │  │REFUNDED│ │FAILED  │
              └──│ (5)    │ │(status │
                 │        │ │=PAID)  │
                 └────────┘ └────────┘
```

## 7. 关键设计决策

### 7.1 金额字段用 Decimal 而非 Float

所有金额字段使用 `@db.Decimal(10, 2)`，并在 DTO 中用 `@DecimalToString()` 转换，避免浮点精度问题。

### 7.2 事务保证退款原子性

退款操作在 `$transaction` 中执行，确保 `退余额 + 退金币 + 状态更新` 要么全部成功，要么全部回滚。

### 7.3 软删除 vs 硬删除

订单使用硬删除（`prisma.order.delete()`），但限制仅 `CANCELED` 和 `REFUNDED` 状态的订单可删除，避免误删有效订单。

### 7.4 搜索性能优化

订单表建立了 4 个索引：

```prisma
@@index([userId])                             // 按用户查询
@@index([treasureId])                         // 按商品查询
@@index([orderStatus, payStatus])             // 按状态筛选（复合索引）
@@index([groupId])                            // 按拼团查询
```

`count` 和 `findMany` 使用 `$transaction` 保证数据一致性。

## 8. 扩展点

1. **批量操作**：扩展 PATCH 支持批量状态更新（选中多订单 → 批量发货/取消）
2. **物流追踪**：对接第三方物流 API（J&T、Lalamove），自动更新运单状态
3. **退款到第三方支付**：当前仅支持余额退款，可扩展 Xendit/Gcash 退款回调
4. **导出 CSV**：基于列表接口，添加 `GET /export?filters` 导出订单数据
5. **操作日志**：记录每次状态变更的操作人、时间、旧值/新值
6. **订单备注**：允许客服在订单上添加内部备注

## 9. 总结

admin-next 订单管理系统展示了完整的 **企业级后台 CRUD + 状态机 + 事务处理** 实现方案：

- **前端**: `useAntdTable` 实现搜索/分页一体化，ModalManager 管理详情/发货/删除弹窗，TanStack Table 配合 9 种状态彩色 Badge
- **后端**: 6 个 REST API，Prisma 动态查询构建，`$transaction` 保证退款原子性，`@IsIn()` DTO 校验限制可设置状态
- **数据库**: Order 模型 32 字段覆盖金额/状态/物流/退款全维度，4 个索引优化查询性能
- **安全**: JwtAuthGuard + PermissionsGuard 双守卫，ORDER.VIEW / UPDATE / DELETE 三级权限
- **测试**: Service 层单元测试覆盖 CRUD + 退款事务 + 边界状态校验
