---
title: admin-next 财务审核工作流——提现审核 + 手动调账
description: 深入分析 Admin Next 财务模块的三个核心组件：WithdrawalList 智能提现列表、WithdrawAuditModal 审核弹窗、ManualAdjustModal 手动调账，揭示 SmartTable + 审核状态机 + Zod 表单的完整实现模式。
slug: finance-audit-withdrawal-adjust-workflow
tags: [admin-next, finance, audit, SmartTable, zod, react-hook-form, revalidation]
date: 2026-05-03
category: admin-next
---

# admin-next 财务审核工作流——提现审核 + 手动调账

> 前置阅读：[SmartTable 泛型智能表格](smart-table-generic-data-grid.md)、[缓存契约模式](cache-contract-pattern-15-modules.md)

## 1. 背景

Admin Next 的财务模块是后台系统的核心功能之一，涉及**提现审核**和**手动调账**两个关键操作。这两个功能需要：

- **提现审核**：管理员审核用户提现申请，查看用户信息、收款账户、金额明细，然后批准/拒绝
- **手动调账**：运营人员在特殊情况下直接调整用户余额（如补偿、扣款）

本文分析三个紧密相关的组件：[`WithdrawalList`](apps/admin-next/src/views/finance/WithdrawalList.tsx)（322L）、[`WithdrawAuditModal`](apps/admin-next/src/views/finance/WithdrawAuditModal.tsx)（302L）、[`ManualAdjustModal`](apps/admin-next/src/views/finance/ManualAdjustModal.tsx)（137L），展示它们如何组合成完整的财务审核工作流。

---

## 2. 架构概览

### 2.1 组件层次

```
WithdrawalList (SmartTable 列表页面)
 ├── WithdrawAuditModal (审核弹窗)
 │    ├── 用户信息卡片
 │    ├── 收款账户卡片
 │    ├── 金额明细看板
 │    └── 审核表单 (remark + approve/reject)
 └── ManualAdjustModal (手动调账弹窗)
      └── Zod 验证表单 (userId + actionType + balanceType + amount + remark)
```

### 2.2 数据流

```
用户提交提现 → WithdrawalList 列表渲染
                      ↓
          管理员点击"审核" → ModalManager.open(WithdrawAuditModal)
                      ↓
          审核 (approve/reject) → financeApi.withdrawalsAudit()
                      ↓
          revalidateFinanceAfterWithdrawAudit() → ISR 缓存刷新
                      ↓
          actionRef.current.reload() → SmartTable 自动刷新
```

### 2.3 状态机

```
PENDING_AUDIT ──→ SUCCESS (批准)
      │
      ├──→ REJECTED (拒绝)
      │
      └──→ PROCESSING (处理中)
```

---

## 3. WithdrawalList——提现列表页

[`WithdrawalList`](apps/admin-next/src/views/finance/WithdrawalList.tsx) 基于 [`SmartTable`](smart-table-generic-data-grid.md) 构建，是典型的列驱动列表页。

### 3.1 列定义

| 列 | 数据源 | 特殊渲染 |
|---|--------|---------|
| 订单号 | `withdrawNo` | 可复制 + 第三方订单号副信息 |
| 用户信息 | `user.nickname` + `user.phone` | 头像首字母 + 手机号 |
| 渠道 | `bankName` + `channelCode` | BANK → 银行图标(紫色)，其他 → 钱包图标(蓝色) |
| 收款人 | `accountName` + `withdrawAccount` | 姓名 + 账户号 |
| 金额 | `withdrawAmount` + `actualAmount` | 申请金额 + 实付金额(高亮) |
| 状态 | `withdrawStatus` | `valueEnum` 映射颜色：黄(待审)/绿(成功)/红(拒绝)/蓝(处理中) |
| 操作 | — | 待审核显示盾牌图标 + 醒目色 |

### 3.2 ChannelIcon 组件

渠道图标的智能渲染：

```tsx
const ChannelIcon = ({ code, name, t }) => {
  const isBank = code?.includes('BANK') || name?.toLowerCase().includes('bank');
  return (
    <div className="flex items-center gap-2">
      <div className={`p-1.5 rounded-full ${isBank ? 'bg-indigo-50 text-indigo-600' : 'bg-blue-50 text-blue-600'}`}>
        {isBank ? <Landmark size={14} /> : <Wallet size={14} />}
      </div>
      <span className="font-medium text-sm">{name || t('finance.withdrawals.unknown')}</span>
    </div>
  );
};
```

关键设计：通过 `channelCode` 和 `name` 双重判定渠道类型，无需后端返回额外字段。

### 3.3 审核操作处理

```tsx
const handleAudit = useCallback((record: WithdrawOrder) => {
  ModalManager.open({
    title: t('finance.withdrawals.auditTitle'),
    renderChildren: ({ confirm }) => (
      <WithdrawAuditModal
        data={record}
        confirm={() => {
          confirm();                    // 关闭弹窗
          actionRef.current?.reload();  // 刷新列表（不 reset 页码）
        }}
      />
    ),
  });
}, [t]);
```

关键设计：
- 审核完成后调用 `actionRef.current?.reload()` 而非 `reset()`，保持当前页码和搜索条件
- `ModalManager.open()` 是 `@repo/ui` 的统一弹窗管理 API

### 3.4 搜索表单

```tsx
const searchSchema: FormSchema[] = [
  { type: 'input', key: 'keyword', label: '搜索', placeholder: '订单号/用户...' },
  { type: 'select', key: 'status', label: '状态', defaultValue: 'ALL',
    options: [{ label: '全部', value: 'ALL' }, ...WITHDRAW_STATUS_OPTIONS] },
  { type: 'date', key: 'dateRange', label: '申请日期',
    props: { placeholder: ['开始日期', '结束日期'] } },
];
```

三个搜索维度：关键字模糊搜索 + 状态筛选 + 日期范围。

### 3.5 请求函数

```tsx
const requestWithdrawals = useCallback(async (params: WithdrawListParams) => {
  const queryInput = parseWithdrawalsSearchParams({
    page: String(params.page ?? 1),
    pageSize: String(params.pageSize ?? 10),
    keyword: typeof input.keyword === 'string' ? input.keyword : undefined,
    status: typeof input.status === 'string' || typeof input.status === 'number'
      ? String(input.status) : undefined,
    startDate: typeof input.startDate === 'string' ? input.startDate : dateRange?.from,
    endDate: typeof input.endDate === 'string' ? input.endDate : dateRange?.to,
  });
  const res = await financeApi.getWithdrawals(buildWithdrawalsListParams(queryInput));
  return { data: res.list, total: res.total, success: true };
}, []);
```

关键设计：`parseWithdrawalsSearchParams` + `buildWithdrawalsListParams` 构成参数解析→构建的双层管道，确保 URL 参数和 API 参数的格式分离。

---

## 4. WithdrawAuditModal——审核弹窗

[`WithdrawAuditModal`](apps/admin-next/src/views/finance/WithdrawAuditModal.tsx) 是提现审核的核心交互界面。

### 4.1 弹窗布局

```
┌──────────────────────────────────────────┐
│  #ORD-20260503-XXXX   2026-05-03 14:30   │  ← 订单号 + 时间 (可复制)
├──────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐      │
│  │ 👤 申请人     │  │ 💳 收款账户   │      │  ← 双列信息卡片
│  │ 头像+昵称    │  │ 渠道名+账号   │      │
│  │ 手机号       │  │ 账户号(可复制)│      │
│  └──────────────┘  └──────────────┘      │
├──────────────────────────────────────────┤
│  申请金额 ₱1,000                          │
│        ↘ 手续费 ₪50 ↗                    │  ← 金额流水看板
│          实付 ₱950                        │
├──────────────────────────────────────────┤
│  ⚠️ 风险验证提示                          │  ← 仅待审核状态显示
│  ├ KYC 验证                               │
│  └ 重复提现检测                            │
│  [备注输入框]                              │
├──────────────────────────────────────────┤
│  [拒绝]              [批准并付款]          │  ← 仅待审核状态显示
└──────────────────────────────────────────┘
```

### 4.2 金额流水看板

```tsx
<div className="bg-gradient-to-r from-gray-50 to-white border rounded-xl p-4">
  <div className="flex items-center justify-between">
    <div className="text-left">
      <div className="text-xs text-gray-400 mb-1">申请金额</div>
      <div className="text-lg font-bold text-gray-700">{NumHelper.formatMoney(data.withdrawAmount)}</div>
    </div>
    <div className="flex flex-col items-center px-2">
      <div className="text-[10px] text-red-500 bg-red-50 px-2 py-0.5 rounded-full mb-1">
        手续费 {NumHelper.formatMoney(data.feeAmount)}
      </div>
      <ArrowRight size={16} className="text-gray-300" />
    </div>
    <div className="text-right">
      <div className="text-xs text-gray-400 mb-1">实付金额</div>
      <div className="text-2xl font-black text-primary-600">{NumHelper.formatMoney(data.actualAmount)}</div>
    </div>
  </div>
</div>
```

视觉层次：申请金额(灰) → 手续费(红标签) → 箭头 → 实付金额(品牌色大字)。左中右三栏布局直观展示资金流向。

### 4.3 审核动作与二次确认

```tsx
const handleAction = (status: WithdrawStatus) => {
  if (status === WITHDRAW_STATUS.SUCCESS) {
    // 批准操作 → 二次确认弹窗
    ModalManager.open({
      title: t('finance.withdrawAudit.confirmTitle'),
      renderChildren: (<div>
        {t('finance.withdrawAudit.confirmMessage', {
          amount: NumHelper.formatMoney(data.actualAmount),
          channel: data.bankName || 'Unknown Channel',
        })}
      </div>),
      onConfirm: () => submitAudit(status),
    });
  } else {
    // 拒绝操作 → 直接提交
    submitAudit(status);
  }
};
```

关键设计：**批准需要二次确认**（金额/渠道双重确认），拒绝直接提交。这防止了误批准操作，同时保持拒绝流程的流畅性。

### 4.4 提交与缓存刷新

```tsx
const submitAudit = async (status: WithdrawStatus) => {
  await runAsync({ withdrawId: data.withdrawId, status, remark });
  void revalidateFinanceAfterWithdrawAudit();  // 触发 ISR 缓存刷新
  confirm();  // 关闭弹窗
};
```

审核完成后异步触发 [`revalidateFinanceAfterWithdrawAudit()`](apps/admin-next/src/lib/actions/finance-revalidate.ts) 让服务端缓存失效，确保列表数据即时更新。

### 4.5 状态驱动的 UI

```tsx
const isWaitForAudit = data.withdrawStatus === WITHDRAW_STATUS.PENDING_AUDIT;
```

整个弹窗的渲染由 `isWaitForAudit` 驱动：

| 状态 | 风险提示 | 备注输入 | 操作按钮 |
|------|---------|---------|---------|
| 待审核 | ✅ 显示警告 | ✅ 可编辑 | ✅ 批准/拒绝 |
| 已审核 | ❌ 隐藏 | ❌ 只读展示审核结果 | ❌ 隐藏 |

---

## 5. ManualAdjustModal——手动调账弹窗

[`ManualAdjustModal`](apps/admin-next/src/views/finance/ManualAdjustModal.tsx) 是运营人员手动调整用户余额的工具。

### 5.1 Zod 验证 Schema

```tsx
const getAdjustSchema = (t: (key: string) => string) =>
  z.object({
    userId: z.string().min(1, t('finance.manualAdjust.validationUserId')),
    actionType: z.coerce.number(),       // 1: 收入, 2: 支出
    balanceType: z.coerce.number(),      // 1: 现金, 2: 金币
    amount: z.coerce.number()
      .positive(t('finance.manualAdjust.validationAmountPositive'))
      .refine(val => /^\d+(\.\d{1,2})?$/.test(String(val)),
        t('finance.manualAdjust.validationAmountDecimal')),
    remark: z.string().min(1, t('finance.manualAdjust.validationRemark')),
  });
```

四个验证规则：
- `userId`：非空字符串
- `amount`：正数 + 最多两位小数
- `remark`：非空（操作必有原因）
- `actionType`/`balanceType`：`z.coerce.number()` 自动类型转换

### 5.2 表单结构

```tsx
<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
  <FormTextField name="userId" label="目标用户ID" />

  <div className="grid grid-cols-2 gap-4">
    <FormSelectField name="actionType" label="操作类型"
      options={[
        { label: '增加', value: String(DIRECTION.INCOME) },
        { label: '扣除', value: String(DIRECTION.EXPENDITURE) },
      ]}
    />
    <FormSelectField name="balanceType" label="资产类型"
      options={[
        { label: '现金余额', value: String(BALANCE_TYPE.CASH) },
        { label: '金币', value: String(BALANCE_TYPE.COIN) },
      ]}
    />
  </div>

  <FormTextField name="amount" label="金额" type="number" />
  <FormTextareaField name="remark" label="调整原因" />

  <div className="flex justify-end gap-3">
    <Button variant="ghost" onClick={close}>取消</Button>
    <Button isLoading={loading} type="submit" variant="primary">确认调账</Button>
  </div>
</form>
```

### 5.3 安全警告

```tsx
<div className="bg-blue-50 text-blue-700 p-3 rounded-md text-sm mb-4">
  ⚠️ <strong>{t('finance.manualAdjust.warning')}</strong>
</div>
```

调账操作直接影响用户余额，因此在表单顶部显示醒目的蓝色警告横幅。

### 5.4 提交与缓存刷新

```tsx
const { run, loading } = useRequest(financeApi.adjust, {
  manual: true,
  onSuccess: () => {
    void revalidateFinanceAfterAdjust();  // 触发财务统计缓存刷新
    confirm();
  },
});
```

使用 `useRequest` 的 `manual: true` 模式手动触发请求，成功后调用 [`revalidateFinanceAfterAdjust()`](apps/admin-next/src/lib/actions/finance-revalidate.ts) 更新财务统计面板。

---

## 6. 审核工作流集成

### 6.1 完整流程时序

```
管理员                              API 服务                      缓存层
  │                                   │                            │
  ├─ 打开提现列表 ──────────────────→ │                            │
  │                                   │                            │
  ├─ 点击"审核" ──────────────────→ │                            │
  │  ModalManager.open()              │                            │
  │                                   │                            │
  ├─ 填写备注 ────────────────────── │                            │
  │                                   │                            │
  ├─ 点击"批准并付款" ──────────────→ │                            │
  │  二次确认弹窗 ──→ 确认           │                            │
  │                                   ├─ POST /withdrawals/audit  │
  │                                   │← 200 OK                    │
  │                                   │                            │
  │  revalidateFinanceAfterWithdraw()─│───────────────────────────→│ 缓存失效
  │                                   │                            │
  │  actionRef.current.reload() ───── │                            │
  │                                   ├─ GET /withdrawals/list ──→│
  │                                   │← 最新数据                  │
  │← 列表刷新完成                      │                            │
```

### 6.2 错误处理

审核操作的错误处理采用分层策略：

```tsx
const submitAudit = async (status: WithdrawStatus) => {
  try {
    await runAsync({ withdrawId: data.withdrawId, status, remark });
    void revalidateFinanceAfterWithdrawAudit();
    confirm();
  } catch (e) {
    // 4xx 由 HTTP 拦截器统一 toast，不重复 console.error
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (!status || status < 400 || status >= 500) console.error(e);
  }
};
```

- **4xx 业务错误**：由 `HttpClient` 拦截器统一处理（toast 提示），catch 中静默忽略
- **5xx 服务端错误**：`console.error` 记录日志
- **网络错误**：`!status` 时记录日志

---

## 7. 与缓存契约模式的集成

审核操作触发两个维度的缓存刷新：

| 操作 | 刷新函数 | 影响范围 |
|------|---------|---------|
| 提现审核 | `revalidateFinanceAfterWithdrawAudit()` | 提现列表缓存 + 财务统计面板 |
| 手动调账 | `revalidateFinanceAfterAdjust()` | 财务统计面板（余额变化） |

这些刷新函数定义在 [`finance-revalidate.ts`](apps/admin-next/src/lib/actions/finance-revalidate.ts)，是 Server Action 层的一部分，通过 `revalidateTag()` 实现精准缓存失效。

---

## 8. 设计要点总结

### 8.1 审核状态机模式

```
待审核 → 二次确认(批准) → API 调用 → 缓存刷新 → 列表刷新
       → 直接提交(拒绝) → API 调用 → 缓存刷新 → 列表刷新
```

### 8.2 安全措施

1. **批准需二次确认**：展示金额和渠道，防止误操作
2. **拒绝必须填写原因**：`remark` 字段必填
3. **调账有警告横幅**：蓝色醒目提示
4. **Zod 验证**：金额正数 + 小数位限制
5. **错误分层处理**：4xx 静默/5xx 日志

### 8.3 性能优化

1. **`actionRef.current?.reload()` 而非 reset()**：保持搜索条件和页码
2. **`void revalidate...()`**：异步触发，不阻塞 UI
3. **`useMemo` 优化**：`statusConfig`、`statusValueEnum` 按需计算
4. **`useCallback` 优化**：`requestWithdrawals`、`handleAudit` 保持引用稳定

### 8.4 用户体验细节

1. **待审核订单橙色高亮按钮**：ShieldCheck 图标 + primary 色
2. **已审核订单灰色查看按钮**：EyeIcon 图标 + outline 样式
3. **渠道名称智能图标**：银行 → 紫色 Landmark，其他 → 蓝色 Wallet
4. **金额右对齐**：财务数据习惯
5. **时间排序允许**：`sorter: true` 可在服务端排序
6. **订单号可复制**：Copy 图标点击复制

---

## 9. 总结

[`WithdrawalList`](apps/admin-next/src/views/finance/WithdrawalList.tsx)、[`WithdrawAuditModal`](apps/admin-next/src/views/finance/WithdrawAuditModal.tsx)、[`ManualAdjustModal`](apps/admin-next/src/views/finance/ManualAdjustModal.tsx) 三个组件共同构成了 admin-next 的财务审核核心工作流。它们的实现展示了：

- **SmartTable + 列驱动列表页**：统一的数据展示模式
- **状态机驱动的审核弹窗**：待审/已审状态决定 UI 渲染
- **Zod + react-hook-form 表单验证**：类型安全的表单管理
- **Server Action 缓存刷新**：审核操作后的即时数据更新
- **二次确认 + 分层错误处理**：资金操作的双重安全保障

### 相关文章

- [SmartTable 泛型智能表格](smart-table-generic-data-grid.md)
- [缓存契约模式](cache-contract-pattern-15-modules.md)
- [交易流水追踪](finance-transaction-deposit-tracking.md)
