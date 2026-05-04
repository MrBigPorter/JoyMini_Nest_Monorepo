---
title: "admin-next 充值同步与交易流水追踪——DepositList / TransactionList 详情弹窗体系"
slug: "finance-deposit-transaction-tracking"
date: "2026-05-03"
description: "深入分析 admin-next 财务模块中充值列表的手动同步机制、充值详情弹窗布局、交易流水列表的颜色编码体系以及交易详情弹窗的多段式信息呈现"
tags: ["admin-next", "React", "SmartTable", "finance", "transaction-tracking", "async-sync"]
---

# admin-next 充值同步与交易流水追踪——DepositList / TransactionList 详情弹窗体系

## 1. 背景

在 [`finance-audit-withdrawal-adjust-workflow.md`](./finance-audit-withdrawal-adjust-workflow.md) 中，我们分析了财务审核工作流的提现审核与手动调账。本篇继续深入财务模块的另外两个核心视图：**充值列表（[`DepositList.tsx`](../../../apps/admin-next/src/views/finance/DepositList.tsx)）** 和 **交易流水列表（[`TransactionList.tsx`](../../../apps/admin-next/src/views/finance/TransactionList.tsx)）**，以及它们对应的详情弹窗 [`DepositDetailModal.tsx`](../../../apps/admin-next/src/views/finance/DepositDetailModal.tsx) 和 [`TransactionDetailModal.tsx`](../../../apps/admin-next/src/views/finance/TransactionDetailModal.tsx)。

充值列表的核心挑战在于**第三方支付渠道的状态不确定性**——用户可能在渠道侧完成支付后，回调延迟或丢失导致系统状态未更新。为此系统提供了**手动同步**机制。交易流水列表则关注**资金流向的可追溯性**，需要清晰展示每笔交易的收入/支出方向、余额快照和关联信息。

## 2. 充值列表（DepositList）

[`DepositList.tsx`](../../../apps/admin-next/src/views/finance/DepositList.tsx)（349 行）使用 [`SmartTable<RechargeOrder>`](../admin/smart-table-generic-data-grid.md) 渲染充值订单列表，核心功能包括视图详情和手动同步。

### 2.1 SmartTable 列配置

列定义通过 [`useMemo`](https://react.dev/reference/react/useMemo) 包裹，包含以下关键列：

| 列 | 渲染方式 | 说明 |
|---|---------|------|
| 充值编号 | `row.rechargeId` | 主键标识 |
| 用户信息 | 组合渲染 | 昵称 + 手机号 |
| 充值金额 | `dom` 透传 | 原始金额值 |
| 渠道 | `getChannelLabel(row.channel)` | GCash / PayMaya / GrabPay / BDO |
| 状态 | [`Badge`](../../../apps/admin-next/src/components/UIComponents.tsx:304) + `depositStatusConfig` | 颜色编码（见下文） |
| 时间 | 格式化 | 创建时间 |
| 操作 | 自定义渲染 | View 按钮 + Sync 按钮 |

### 2.2 状态颜色编码

状态枚举值通过 [`getDepositStatusConfig()`](../apps/admin-next/src/views/finance/type.ts:32) 生成：

```typescript
export function getDepositStatusConfig(t: TLabelFn): Record<string, { color: string; label: string; buttonColor?: string }> {
  // PENDING: yellow
  // SUCCESS: green
  // FAILED: red
  // EXPIRED: gray
  // SYNCED_SUCCESS: green (with buttonColor)
  // SYNCED_EXPIRED: orange
}
```

每个状态映射到 `{ color, label, buttonColor? }`，其中 `buttonColor` 仅用于"查看详情"按钮的着色。

### 2.3 手动同步机制

手动同步是该视图最核心的业务逻辑，处理第三方支付回调不可靠的问题。

#### 状态管理

```typescript
const [syncingId, setSyncingId] = useState<number | null>(null);
```

`syncingId` 跟踪当前正在同步的充值订单 ID，确保同一时间只有一个同步操作在进行，防止重复点击。

#### 同步触发

[`handleSync`](../../../apps/admin-next/src/views/finance/DepositList.tsx:105) 回调接收 `record: RechargeOrder`，调用 `syncRecharge` 方法：

```typescript
const handleSync = useCallback(
  async (record: RechargeOrder) => {
    setSyncingId(record.rechargeId);
    await syncRecharge(record.rechargeId);
  },
  [syncRecharge]
);
```

#### 同步 API 与状态处理

[`syncRecharge`](../../../apps/admin-next/src/views/finance/DepositList.tsx:98) 使用 [`useRequest`](https://ahooks.js.org/hooks/use-request) 封装：

```typescript
const syncRecharge = useRequest(financeApi.syncRecharge, {
  manual: true,
  onSuccess: (res) => {
    if (res === 'SYNCED_SUCCESS') {
      addToast(t('finance.recharge.syncedSuccess'), 'success');
      revalidateFinanceAfterRechargeSync();
    } else if (res === 'SYNCED_EXPIRED') {
      addToast(t('finance.recharge.syncedExpired'), 'info');
    }
    actionRef.current?.reload();
  },
  onFinally: () => {
    setSyncingId(null);
  },
});
```

**三种响应路径**：
- `SYNCED_SUCCESS`：同步成功，充值状态已更新 → 弹出成功提示 + 调用 [`revalidateFinanceAfterRechargeSync()`](../../../apps/admin-next/src/lib/actions/finance-revalidate.ts:37) 使 ISR 缓存失效
- `SYNCED_EXPIRED`：该充值单已过期，同步后仍为失败状态 → 弹出信息提示
- 其他情况（网络错误等）：由 HTTP 拦截器统一处理

**`onFinally`** 无论成功还是失败，都调用 `setSyncingId(null)` 恢复 UI 状态。

#### 同步按钮的 UI 反馈

同步按钮仅在订单状态为 `PENDING` 时显示：

```typescript
{isPending && (
  <Button
    variant="outline"
    className="border-amber-300 text-amber-600 hover:bg-amber-50"
    loading={syncingId === row.rechargeId}
    onClickAction={() => handleSync(row)}
  >
    {syncingId === row.rechargeId ? (
      <RefreshCw className="animate-spin" size={14} />
    ) : (
      <RefreshCw size={14} />
    )}
    {t('finance.recharge.sync')}
  </Button>
)}
```

关键设计点：
- 按钮使用 **amber（琥珀色）** 主题色，与 View 按钮（状态色）区分，强调这是一个**手动干预操作**
- 同步中显示 `animate-spin` CSS 旋转动画，提供直观的加载反馈
- 通过 `loading` prop 禁用按钮防止重复点击

### 2.4 查看详情

[`handleViewDetail`](../../../apps/admin-next/src/views/finance/DepositList.tsx:65) 打开 [`DepositDetailModal`](#3-充值详情弹窗-depositdetailmodal)：

```typescript
const handleViewDetail = useCallback(
  (record: RechargeOrder) => {
    ModalManager.open({
      title: t('finance.recharge.detail'),
      renderChildren: ({ closeAction }) => (
        <DepositDetailModal data={record} closeAction={closeAction} />
      ),
    });
  },
  [t]
);
```

### 2.5 搜索表单

搜索模式包含四个字段：

```typescript
const searchSchema: FormSchema[] = useMemo(
  () => [
    { key: 'keyword', label: t('finance.keyword'), type: 'input' },
    { key: 'channel', label: t('finance.channel'), type: 'select', options: channelOptions },
    { key: 'status', label: t('finance.status'), type: 'select', options: statusOptions },
    { key: 'dateRange', label: t('finance.dateRange'), type: 'date', mode: 'range' },
  ],
  [channelOptions, statusOptions, t]
);
```

`statusOptions` 从 `getDepositStatusConfig` 的 entries 映射而来，自动同步状态标签的国际化。

### 2.6 导出 CSV

[`toolBarRender`](../../../apps/admin-next/src/views/finance/DepositList.tsx:317) 提供了一个导出按钮，使用 [`ExportButton`](../../../apps/admin-next/src/components/UIComponents.tsx:169) 组件，将当前列表数据导出为 CSV 文件。

## 3. 充值详情弹窗（DepositDetailModal）

[`DepositDetailModal.tsx`](../../../apps/admin-next/src/views/finance/DepositDetailModal.tsx)（105 行）是一个轻量级的详情展示弹窗，采用**卡片式布局**。

### 3.1 金额概览卡

弹窗顶部是一张绿色翡翠背景的金额卡片：

```typescript
<div className="bg-emerald-50 dark:bg-emerald-900/30 rounded-xl p-4 mb-4">
  <div className="text-xs text-emerald-600 dark:text-emerald-400 mb-1">
    {t('finance.recharge.amount')}
  </div>
  <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">
    {formatCurrency(data.rechargeAmount)}
  </div>
</div>
```

使用 `bg-emerald-50` 浅绿色背景 + `text-emerald-700` 深绿色文字，视觉上传达"收入/资金流入"的语义。

### 3.2 InfoRow 组件

[`InfoRow`](../../../apps/admin-next/src/views/finance/DepositDetailModal.tsx:11) 是一个内联原子组件：

```typescript
const InfoRow = ({
  label,
  value,
  icon: Icon,
  className = '',
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ComponentType<{ size?: number }>;
  className?: string;
}) => (
  <div className={className}>
    <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5 flex items-center gap-1">
      {Icon && <Icon size={12} />}
      {label}
    </div>
    <div className="text-sm font-medium break-words">{value}</div>
  </div>
);
```

设计要点：
- **标签**使用 `text-xs text-gray-500` 弱化视觉权重
- **值**使用 `text-sm font-medium` 突出显示
- 可选的 `icon` prop 在标签旁显示图标
- `break-words` 防止长文本溢出

### 3.3 布局结构

弹窗采用两列网格布局：

```
┌──────────────────────────────────────┐
│         金额概览卡（翡翠绿）          │
├────────────────────┬─────────────────┤
│ 用户昵称           │ 充值渠道        │
│ 手机号             │ 渠道订单号      │
├────────────────────┴─────────────────┤
│ 系统订单号（可复制，font-mono 加粗）  │
├──────────────────────────────────────┤
│ 第三方订单号（bg-gray-100, select-all)│
├────────────────────┬─────────────────┤
│ 创建时间           │ 支付时间        │
└────────────────────┴─────────────────┘
```

关键交互细节：
- **系统订单号**：使用 `font-mono` 等宽字体 + `font-bold` 加粗，旁边有 [`Copy`](https://lucide.dev/icons/copy) 图标，点击复制到剪贴板
- **第三方订单号**：`bg-gray-100` 浅灰背景区分视觉层级，`select-all` CSS 使点击后全选文本，方便手动复制
- **支付时间**仅在存在时显示，使用 `paidAt ? <InfoRow ... /> : null` 条件渲染

## 4. 交易流水列表（TransactionList）

[`TransactionList.tsx`](../../../apps/admin-next/src/views/finance/TransactionList.tsx)（272 行）展示用户的钱包交易流水，与充值/提现列表不同，它关注的是**资金变动记录**而非订单状态。

### 4.1 AmountDisplay 颜色编码

[`AmountDisplay`](../../../apps/admin-next/src/views/finance/TransactionList.tsx:60) 是一个内联组件，根据交易类型决定金额颜色：

```typescript
const AmountDisplay = ({
  amount,
  type,
}: {
  amount: number;
  type: TransactionType;
}) => {
  const isIncome = ['RECHARGE', 'REWARD', 'INVITE_REWARD', 'REFUND'].includes(type);
  const colorClass = isIncome ? 'text-emerald-500' : 'text-rose-500';
  const sign = isIncome ? '+' : '-';

  return (
    <span className={`font-mono font-semibold ${colorClass}`}>
      {sign}{formatCurrency(amount)}
    </span>
  );
};
```

**颜色语义**：
- **翡翠绿（`text-emerald-500`）**：收入类型 — 充值（RECHARGE）、奖励（REWARD）、邀请奖励（INVITE_REWARD）、退款（REFUND）
- **玫瑰红（`text-rose-500`）**：支出类型 — 提现（WITHDRAWAL）、消费等

金额前显示 `+` / `-` 符号，一眼即可识别资金流向。

### 4.2 交易类型列

[交易类型列](../../../apps/admin-next/src/views/finance/TransactionList.tsx:117) 使用 [`Badge`](https://lucide.dev/icons) + 图标组合：

```typescript
{
  title: t('finance.transactionType'),
  dataIndex: 'transactionType',
  key: 'transactionType',
  valueEnum: TRANSACTION_TYPE_OPTIONS.reduce(
    (acc, item) => {
      acc[item.value] = { text: item.label };
      return acc;
    },
    {} as Record<number, { text: string }>
  ),
  render: (_, row) => {
    const type = row.transactionType;
    const isIncome = ['RECHARGE', 'REWARD', 'INVITE_REWARD', 'REFUND'].includes(type);
    const Icon = isIncome ? ArrowDownRight : type === 'WITHDRAWAL' ? ArrowUpRight : Repeat;
    const color = isIncome ? 'green' : type === 'WITHDRAWAL' ? 'warning' : 'default';

    return (
      <Badge variant="outline" color={color}>
        <Icon size={14} />
        <span>{TRANSACTION_TYPE_LABEL[type] || type}</span>
      </Badge>
    );
  },
}
```

**图标+颜色映射**：

| 交易类型 | 图标 | Badge 颜色 | 语义 |
|---------|------|-----------|------|
| 充值/收入类 | `ArrowDownRight` | green | 资金流入 |
| 提现 | `ArrowUpRight` | warning | 资金流出（需关注） |
| 其他 | `Repeat` | default | 中性 |

`valueEnum` 从 `TRANSACTION_TYPE_OPTIONS` 动态构建，确保搜索下拉选项与列渲染标签一致。

### 4.3 余额快照

[余额列](../../../apps/admin-next/src/views/finance/TransactionList.tsx:157) 展示交易前后的余额变化：

```typescript
{
  title: t('finance.balance'),
  dataIndex: 'afterBalance',
  key: 'afterBalance',
  render: (dom, row) => (
    <span className="font-mono text-sm">
      {formatCurrency(row.beforeBalance)} → {formatCurrency(row.afterBalance)}
    </span>
  ),
}
```

使用 `→` 箭头连接交易前后余额，提供完整的资金变动轨迹。

### 4.4 搜索配置

搜索模式包含三个字段：

```typescript
const searchSchema: FormSchema[] = useMemo(
  () => [
    { key: 'keyword', label: t('finance.keyword'), type: 'input' },
    {
      key: 'transactionType',
      label: t('finance.transactionType'),
      type: 'select',
      options: TRANSACTION_TYPE_OPTIONS.map((opt) => ({
        label: opt.label,
        value: opt.value,
      })),
    },
    { key: 'dateRange', label: t('finance.dateRange'), type: 'date', mode: 'range' },
  ],
  [t]
);
```

`TRANSACTION_TYPE_OPTIONS` 由 [`Object.entries(TRANSACTION_TYPE).map(([key, value]) => ({ label: key, value }))`](../../../apps/admin-next/src/views/finance/TransactionList.tsx:206) 生成，保证类型选项与枚举定义同步。

## 5. 交易详情弹窗（TransactionDetailModal）

[`TransactionDetailModal.tsx`](../../../apps/admin-next/src/views/finance/TransactionDetailModal.tsx)（224 行）是交易流水列表的详情弹窗，采用**多段式信息呈现**布局。

### 5.1 金额概览卡

弹窗顶部根据交易状态呈现不同颜色的金额卡片：

```typescript
const isSuccess = data.status === TRANSACTION_STATUS?.SUCCESS;
const isFailed = data.status === TRANSACTION_STATUS?.FAILED;

<div className={`rounded-xl p-4 mb-4 ${
  isSuccess ? 'bg-emerald-50 dark:bg-emerald-900/30' :
  isFailed ? 'bg-rose-50 dark:bg-rose-900/30' :
  'bg-gray-50 dark:bg-gray-800'
}`}>
  <Badge color={isSuccess ? 'green' : isFailed ? 'red' : 'yellow'}>
    {getStatusLabel(data.status)}
  </Badge>
  <div className="text-2xl font-bold mt-2">
    {formatCurrency(data.amount)}
  </div>
</div>
```

**状态颜色映射**：
- **成功（`TRANSACTION_STATUS.SUCCESS`）**：翡翠绿背景 + 绿色 Badge
- **失败（`TRANSACTION_STATUS.FAILED`）**：玫瑰红背景 + 红色 Badge
- **处理中/其他**：灰色背景 + 黄色 Badge

### 5.2 用户信息区

用户信息以两列网格展示：

```typescript
<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
  <InfoRow label={t('finance.userNickname')} value={data.userNickname || '-'} icon={User} />
  <InfoRow label={t('finance.userPhone')} value={data.userPhone || '-'} icon={Phone} />
  <InfoRow label={t('finance.userId')} value={data.userId} icon={Hash} />
</div>
```

每个字段都带对应的 Lucide 图标（User / Phone / Hash），增强视觉识别度。

### 5.3 交易详情区

交易详情区包含五个关键字段：

```typescript
<InfoRow label={t('finance.transactionNo')} value={
  <div className="flex items-center gap-2 min-w-0">
    <span className="truncate">{data.transactionNo}</span>
    <Copy text={data.transactionNo} />
  </div>
} />
<InfoRow label={t('finance.transactionType')} value={
  <Badge variant="outline" color={/* 根据类型选择颜色 */}>
    {Icon}<span>{TRANSACTION_TYPE_LABEL[data.transactionType]}</span>
  </Badge>
} />
<InfoRow label={t('finance.assetClass')} value={
  <Badge variant="outline">
    {isCash ? '💰 ' + t('finance.cash') : '🪙 ' + t('finance.coins')}
  </Badge>
} />
<InfoRow label={t('finance.time')} value={
  <span className="flex items-center gap-1">
    <Clock size={14} />{formatDateTime(data.createdAt)}
  </span>
} />
```

**交易号**：使用 [`Copy`](https://lucide.dev/icons/copy) 组件提供一键复制功能，`truncate` 防止过长文本撑破布局。

**资产类型**：通过 `isCash = data.balanceType === BALANCE_TYPE?.CASH` 判断是现金还是金币，使用 emoji 增强可读性。

### 5.4 关联引用区

关联引用使用**虚线边框**（`border-dashed`）容器包裹，视觉上区分于其他信息区域：

```typescript
<div className="col-span-2 p-3 bg-gray-50 dark:bg-white/5 rounded-lg border border-dashed border-gray-300 dark:border-white/10">
  <div className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wider">
    {t('finance.relatedRef')}
  </div>
  <InfoRow label={t('finance.relatedId')} value={data.relatedId || '-'} />
  <InfoRow label={t('finance.relatedType')} value={data.relatedType || '-'} />
</div>
```

- 标题使用 `uppercase tracking-wider` 全大写+字距，模拟"区段标题"样式
- 虚线边框 + 浅灰背景，暗示这是一个"引用/外键"而非核心数据

### 5.5 余额快照区

[余额快照](../../../apps/admin-next/src/views/finance/TransactionDetailModal.tsx:136) 展示资金变动的完整轨迹：

```typescript
<InfoRow label={t('finance.beforeBalance')} value={
  <span className="font-mono">{formatCurrency(data.beforeBalance)}</span>
} />
<InfoRow label={t('finance.afterBalance')} value={
  <span className="font-mono font-semibold">{formatCurrency(data.afterBalance)}</span>
} />
```

- 前余额使用普通 `font-mono`
- 后余额使用 `font-mono font-semibold` 加粗，强调交易后的结果状态

### 5.6 描述与备注区

弹窗底部展示交易的描述和备注信息：

```typescript
<div className="col-span-2 pt-2">
  <InfoRow label={t('finance.description')} value={data.description || '-'} />
  {data.remark && (
    <div className="mt-3">
      <InfoRow label={t('finance.remark')} value={data.remark} />
    </div>
  )}
</div>
```

`remark`（备注）使用条件渲染，仅在存在时显示，避免展示空字段。

### 5.7 弹窗布局总览

```
┌──────────────────────────────────────────┐
│       金额概览卡（绿/红/灰 + Badge）      │
├──────────────────────┬───────────────────┤
│ 用户信息              │                   │
│   👤 昵称            │  交易详情          │
│   📞 手机号          │  交易号 (Copy)     │
│   # 用户ID           │  类型 Badge + Icon │
│                      │  资产类目          │
│                      │  时间 (Clock)      │
├──────────────────────┴───────────────────┤
│  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐    │
│  关联引用（虚线边框）                    │
│  关联 ID / 关联类型                     │
│  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘    │
├──────────────────────┬───────────────────┤
│ 前余额 (font-mono)   │ 后余额 (加粗)     │
├──────────────────────┴───────────────────┤
│ 描述                                      │
│ 备注（条件渲染）                          │
└──────────────────────────────────────────┘
```

## 6. 充值与交易流水的工作流集成

充值列表和交易流水列表虽然独立展示，但在业务上紧密关联：

### 6.1 数据流

```
第三方支付渠道
    ↓ (回调/主动同步)
充值订单 (RechargeOrder)
    ↓ (支付成功)
钱包交易流水 (WalletTransaction)
    ├── 类型: RECHARGE
    ├── 金额: +充值金额
    └── 余额: 前余额 → 后余额
```

一次充值成功会同时产生：
1. 充值订单状态更新（`RechargeOrder.status → SUCCESS`）
2. 钱包交易流水记录（`WalletTransaction.type = RECHARGE`）

### 6.2 同步后的连锁反应

当运营人员在充值列表点击"同步"并成功（`SYNCED_SUCCESS`）后：

1. 调用 `syncRecharge()` API 与第三方渠道对账
2. 充值订单状态更新为 `SUCCESS`
3. 系统自动创建一笔 `RECHARGE` 类型的交易流水
4. [`revalidateFinanceAfterRechargeSync()`](../../../apps/admin-next/src/lib/actions/finance-revalidate.ts:37) 使 ISR 缓存失效
5. 充值列表和交易流水列表在下一次请求时都能获取最新数据

## 7. 缓存集成

充值列表和交易流水列表共享同一套缓存失效机制：

| 操作 | 触发条件 | 缓存标签 |
|-----|---------|---------|
| 充值同步成功 | `syncRecharge` → `SYNCED_SUCCESS` | `finance-recharge` |
| 手动调账 | `ManualAdjustModal` 提交 | `finance-adjust` |
| 提现审核 | `submitAudit` 提交 | `finance-withdraw` |
| 财务统计 | 任意财务变更 | `finance-stats` |

所有财务相关的 Server Action 集中在 [`finance-revalidate.ts`](../../../apps/admin-next/src/lib/actions/finance-revalidate.ts)，统一管理 ISR 缓存失效。

## 8. 设计要点总结

### 8.1 颜色编码体系

| 组件 | 颜色 | 语义 |
|------|------|------|
| DepositList Sync 按钮 | Amber（琥珀色） | 手动干预操作 |
| DepositDetailModal 金额卡 | Emerald（翡翠绿） | 资金流入 |
| TransactionList AmountDisplay | Emerald / Rose | 收入/支出 |
| TransactionDetailModal 金额卡 | Emerald / Rose / Gray | 成功/失败/处理中 |
| TransactionDetailModal 引用区 | Dashed + Gray | 外键引用，非核心数据 |

### 8.2 交互模式

- **同步操作**：`syncingId` + `animate-spin` + `loading` prop 三重防重复保障
- **复制操作**：`Copy` 组件 + `select-all` CSS + `font-mono` 字体，覆盖不同复制场景
- **详情弹窗**：统一的 [`ModalManager.open()`](https://lucide.dev/icons) API，`closeAction` 回调管理弹窗生命周期
- **条件渲染**：空字段不展示（remark、paidAt），避免无效信息

### 8.3 代码组织模式

与 [`WithdrawalList.tsx`](./finance-audit-withdrawal-adjust-workflow.md) 一致的模式：
- `useMemo` 包裹 `columns` + `searchSchema`
- `useCallback` 包裹事件处理函数
- `useRequest` 管理 API 调用状态
- 内联原子组件（`InfoRow`、`AmountDisplay`）定义在文件顶部
- 状态配置函数集中定义在 [`type.ts`](../../../apps/admin-next/src/views/finance/type.ts)

## 9. 总结

充值列表与交易流水列表构成了 admin-next 财务模块的**资金追踪链路**。充值列表通过手动同步机制解决了第三方支付回调不可靠的现实问题；交易流水列表通过颜色编码和余额快照提供了完整的资金变动轨迹。两个详情弹窗（`DepositDetailModal` / `TransactionDetailModal`）则分别以**卡片式布局**和**多段式信息呈现**满足了不同的业务查看需求。

从架构视角看，这套设计与提现审核工作流共享相同的 [`SmartTable`](../admin/smart-table-generic-data-grid.md) + [`ModalManager`](../../../apps/admin-next/src/components/UIComponents.tsx:336) + Server Action 缓存的底层基础设施，保证了整个财务模块的**一致性和可维护性**。

### 相关文章

- [`finance-audit-withdrawal-adjust-workflow.md`](./finance-audit-withdrawal-adjust-workflow.md) — 提现审核 + 手动调账工作流
- [`smart-table-generic-data-grid.md`](../admin/smart-table-generic-data-grid.md) — SmartTable 泛型表格详解
- [`server-prefetch-isr.md`](./server-prefetch-isr.md) — ISR 缓存策略与 Server Action 失效机制
- [`ui-components-library.md`](./ui-components-library.md) — Badge / Button / Modal 等基础组件
