---
title: "admin-next 优惠券营销系统——CouponList 列表 + CouponModal 表单联动与字段安全锁定"
slug: "coupon-marketing-system"
date: "2026-05-03"
description: "深入分析 admin-next 营销模块中优惠券列表的进度条渲染、表单的条件字段联动、编辑模式下的字段安全锁定策略以及双向数据转换器模式"
tags: ["admin-next", "React", "Coupon", "marketing", "react-hook-form", "useAntdTable", "BaseTable"]
---

# admin-next 优惠券营销系统——CouponList 列表 + CouponModal 表单联动与字段安全锁定

## 1. 背景

优惠券（Coupon）是电商营销系统的核心实体，涉及丰富的配置维度：优惠类型（满减/折扣/无门槛）、发放方式（系统发放/用户领取/兑换码/邀请）、有效期类型（固定日期/领取后天数）、库存与限领等。这些维度的组合使得表单的条件渲染和编辑时的字段锁定变得复杂。

本篇分析 [`Coupon.tsx`](../../../apps/admin-next/src/views/Marketing/Coupon.tsx)（417 行）和 [`CouponModal.tsx`](../../../apps/admin-next/src/views/Marketing/CouponModal.tsx)（395 行），重点覆盖优惠券列表的**进度条渲染**、表单的**条件字段联动**、以及编辑模式下的**敏感字段安全锁定**。

## 2. CouponList——优惠券列表

[`CouponList`](../../../apps/admin-next/src/views/Marketing/Coupon.tsx:58) 使用不同于财务模块的组件栈：`SchemaSearchForm` + `BaseTable` 而非 `SmartTable`。

### 2.1 组件架构概览

```
CouponList
├── PageHeader (title + create button)
├── Card
│   ├── SchemaSearchForm (keyword + status + couponType)
│   └── BaseTable
│       ├── couponInfo (name + code + status badge + issueType badge)
│       ├── benefit (discount display + minPurchase)
│       ├── usage (progress bar)
│       ├── validity (date range / days after claim)
│       └── actions (edit + delete buttons)
```

### 2.2 数据获取：useAntdTable

与财务模块的 `SmartTable` 不同，CouponList 直接使用 [`useAntdTable`](https://ahooks.js.org/hooks/use-antd-table)：

```typescript
const getTableData = async (
  { current, pageSize },
  formData: CouponSearchForm,
) => {
  const params: CouponListParams = { page: current, pageSize };
  if (formData?.keyword?.trim()) { params.keyword = formData.keyword.trim(); }
  if (formData?.status && formData.status !== 'ALL') { params.status = Number(formData.status); }
  if (formData?.couponType && formData.couponType !== 'ALL') { params.couponType = Number(formData.couponType); }
  const res = await couponApi.getList(params);
  return { list: res.list, total: res.total };
};

const { tableProps, refresh, run, search: { reset } } = useAntdTable(getTableData, {
  manual: true, defaultPageSize: 10,
  defaultParams: [{ current: 1, pageSize: 10 }, { keyword: '', status: 'ALL', couponType: 'ALL' }],
});
```

关键点：
- `useAntdTable` 返回的 `tableProps` 集成了数据、分页、加载状态
- `manual: true` 手动触发，通过 `useEffect` 在组件挂载时初始化
- 搜索参数中的 `'ALL'` 表示不过滤

### 2.3 列渲染详解

列定义使用 [`createColumnHelper<Coupon>()`](https://tanstack.com/table/v8/docs/api/core/column-helper)：

#### 优惠信息列

```typescript
columnHelper.accessor('couponName', {
  header: t('coupon.couponInfo'),
  cell: (info) => (
    <div>
      <div className="flex items-center gap-2">
        <span className="font-medium">{info.getValue()}</span>
        {info.row.original.couponCode && (
          <span className="inline-flex items-center rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
            <Hash size={10} className="mr-0.5" />
            {info.row.original.couponCode}
          </span>
        )}
      </div>
      <div className="mt-1 flex gap-2">
        <StatusBadge status={info.row.original.status} />
        <Badge color="blue">{/* issueType */}</Badge>
      </div>
    </div>
  ),
});
```

优惠名称下方展示 **状态 Badge** + **发放方式 Badge**，形成紧凑的信息聚合。

#### 优惠力度列

```typescript
columnHelper.accessor('discountValue', {
  header: t('coupon.benefit'),
  cell: (info) => {
    const { discountType, minPurchase } = info.row.original;
    const isPercent = discountType === DISCOUNT_TYPE.PERCENTAGE;
    const valueStr = isPercent
      ? t('coupon.benefitPercentOff', { rate: NumHelper.formatRate(info.getValue()) })
      : `-${NumHelper.formatMoney(info.getValue())}`;
    return (
      <div className="flex flex-col">
        <span className="font-semibold text-pink-600">{valueStr}</span>
        <span className="text-xs text-gray-500">
          {t('coupon.benefitMin', { amount: NumHelper.formatMoney(minPurchase) })}
        </span>
      </div>
    );
  },
});
```

- 折扣值使用 **pink-600** 强化视觉
- 百分比折扣使用 `NumHelper.formatRate()` 格式化
- 下方以小字展示最低消费门槛

#### 使用量进度条

```typescript
columnHelper.display({
  id: 'usage',
  header: t('coupon.usage'),
  cell: (info) => {
    const { issuedQuantity = 0, totalQuantity } = info.row.original;
    const isUnlimited = totalQuantity === -1;
    let percent = 0;
    if (!isUnlimited && totalQuantity > 0) {
      const ratio = CalcHelper.div(issuedQuantity, totalQuantity);
      percent = CalcHelper.round(CalcHelper.mul(ratio, 100), 0);
      if (percent > 100) percent = 100;
    }
    return (
      <div className="w-24">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-500">{t('coupon.usageUsed')}</span>
          <span className="font-medium">{isUnlimited ? t('coupon.usageUnlimited') : `${percent}%`}</span>
        </div>
        <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-300 ${
            isUnlimited ? 'bg-green-500' : 'bg-blue-500'
          }`} style={{ width: isUnlimited ? '100%' : `${percent}%` }} />
        </div>
        <div className="text-[10px] text-gray-400 mt-1">
          {NumHelper.formatNumber(issuedQuantity)} / {isUnlimited ? '∞' : NumHelper.formatNumber(totalQuantity)}
        </div>
      </div>
    );
  },
});
```

进度条的关键逻辑：
- `totalQuantity === -1` 表示**不限量**，显示绿色满格 + `∞` 符号
- 有限量时通过 [`CalcHelper`](https://github.com/dmitry-zaets/number-precision) 进行精确除法/乘法，避免浮点精度问题
- 上限保护：`percent > 100` 时截断到 100%
- 使用 `transition-all duration-300` 实现平滑宽度过渡

#### 有效期列

```typescript
columnHelper.accessor('validType', {
  header: t('coupon.validity'),
  cell: (info) => {
    const row = info.row.original;
    if (row.validType === VALID_TYPE.RANGE) {
      return (
        <div className="text-xs text-gray-600">
          <div className="flex items-center gap-1">
            <Calendar size={12} />{TimeHelper.formatDate(row.validStartAt)}
          </div>
          <div className="pl-4 text-gray-400">
            {t('coupon.validityTo', { date: TimeHelper.formatDate(row.validEndAt) })}
          </div>
        </div>
      );
    }
    return (
      <div className="text-xs flex items-center gap-1 text-orange-600">
        <Calendar size={12} />
        {t('coupon.validityDaysAfterClaim', { days: row.validDays ?? 0 })}
      </div>
    );
  },
});
```

两种有效期类型的不同渲染：
- **固定日期范围**：上下两行显示起止日期，`pl-4` 缩进实现视觉层级
- **领取后天数**：单行橙色文字，强调"领取后 N 天"的动态计算特性

### 2.4 操作按钮

编辑和删除按钮使用 `variant="ghost"` 配合图标：

```typescript
<Button size="sm" variant="ghost" onClick={() => handleOpenModal(info.row.original)}>
  <Edit3 size={14} />
</Button>
<Button size="sm" variant="ghost" onClick={() => handleDelete(info.row.original)}>
  <Trash2 size={14} />
</Button>
```

删除操作通过 [`ModalManager.open()`](https://lucide.dev/icons) 的简化形式（`content` + `confirmText` + `onConfirm`）触发二次确认。

### 2.5 搜索表单

搜索使用 [`SchemaSearchForm`](../../../apps/admin-next/src/components/scaffold/SchemaSearchForm.tsx) 声明式配置：

```typescript
<SchemaSearchForm<CouponSearchForm>
  schema={[
    { type: 'input', key: 'keyword', label: t('coupon.search') },
    { type: 'select', key: 'status', label: t('coupon.status'), defaultValue: 'ALL',
      options: [{ label: t('coupon.allStatus'), value: 'ALL' }].concat(
        Object.entries(COUPON_STATUS).map(([, val]) => ({
          label: val === COUPON_STATUS.ACTIVE ? t('coupon.statusActive') : t('coupon.statusInactive'),
          value: val.toString(),
        })),
      ),
    },
    { type: 'select', key: 'couponType', label: t('coupon.type'), defaultValue: 'ALL',
      options: [{ label: t('coupon.allTypes'), value: 'ALL' }].concat(
        COUPON_TYPE_OPTIONS.map((option) => ({...})),
      ),
    },
  ]}
  onSearch={handleSearch}
  onReset={handleReset}
/>
```

`'ALL'` 作为一个特殊的过滤值，在 API 调用时被跳过（`if status !== 'ALL'`），实现"不限"的语义。

## 3. CouponModal——优惠券表单

[`CouponModal`](../../../apps/admin-next/src/views/Marketing/CouponModal.tsx:102) 是优惠券的创建/编辑表单，其核心复杂度在于**条件字段联动**和**编辑模式下的字段锁定**。

### 3.1 双向数据转换器

组件定义了两个对称的转换函数实现 API 数据 ↔ 表单数据的双向映射：

```typescript
// 表单 → API payload
const transformFormToPayload = (values: CreateCouponSchemaFormInput): CreateCouponPayload => {
  const payload = {
    ...values,
    discountValue: Number(values.discountValue),
    // ... 所有数字字段的 Number() 转换
  };
  // 清理逻辑
  if (payload.couponCode === '') payload.couponCode = undefined;
  if (payload.discountType !== DISCOUNT_TYPE.PERCENTAGE) payload.maxDiscount = undefined;
  if (payload.validType === VALID_TYPE.DAYS_AFTER_RECEIVE) {
    payload.validStartAt = undefined;
    payload.validEndAt = undefined;
  }
  return payload;
};

// API payload → 表单
const transformPayloadToForm = (payload: Coupon): Partial<CreateCouponSchemaFormInput> => {
  return {
    ...payload,
    discountValue: Number(payload.discountValue),
    // ... 所有数字字段的 Number() 转换
    validStartAt: payload.validStartAt ? new Date(payload.validStartAt) : undefined,
    validEndAt: payload.validEndAt ? new Date(payload.validEndAt) : undefined,
  };
};
```

这种双向转换模式解决了三个问题：
1. **类型统一**：API 返回的字段可能是 `string` 或 `number`，统一转为 `number`
2. **日期转换**：ISO 字符串 ↔ `Date` 对象
3. **语义清理**：不适用字段设为 `undefined`，避免后端校验报错

### 3.2 字段安全锁定

这是 CouponModal 最重要的业务逻辑——**已发放优惠券的关键字段不可修改**：

```typescript
const isCriticalDisabled = !!editingData?.issuedQuantity;
```

当 `issuedQuantity > 0`（即已发放数量大于 0）时，以下字段被锁定：
- `couponType`（优惠类型）
- `discountType`（折扣类型）
- `discountValue`（折扣值）
- `minPurchase`（最低消费）
- `maxDiscount`（最大折扣）
- `validType`（有效期类型）
- `validDays` / `validStartAt` / `validEndAt`（有效期）
- `issueType`（发放方式）

这些字段通过 React Hook Form 的 [`disabled`](https://react-hook-form.com/docs/useform/register) prop 禁用，视觉上灰显。

### 3.3 敏感字段剥离

更为关键的是，在提交更新时，已发放优惠券的敏感字段被**彻底从 payload 中删除**，而非仅仅禁用 UI：

```typescript
if ((editingData?.issuedQuantity ?? 0) > 0) {
  const d = data as unknown as Record<string, unknown>;
  delete d.couponType;
  delete d.discountType;
  delete d.discountValue;
  delete d.minPurchase;
  delete d.maxDiscount;
  delete d.validType;
  delete d.validDays;
  delete d.validStartAt;
  delete d.validEndAt;
  delete d.issueType;
}
return couponApi.update(editingData.id, data);
```

这背后的原因是：
1. **后端校验严格**：即使字段值不变，`"30" !== "30.00"` 的类型差异也会触发 400 错误
2. **安全防御**：即使前端 UI 禁用了字段，也不能保证恶意请求不会篡改。在 payload 层删除是双重保险
3. **幂等性**：已发放的优惠券修改非关键字段（如名称、描述、副标题）应该是安全的

### 3.4 条件字段联动

表单使用 [`form.watch`](https://react-hook-form.com/docs/useform/watch) 实现响应式联动：

```typescript
const discountType = form.watch('discountType');
const validType = form.watch('validType');
const discountTypeNum = Number(discountType || DISCOUNT_TYPE.FIXED_AMOUNT);
const validTypeNum = Number(validType || VALID_TYPE.RANGE);
```

**折扣类型联动**：

```
discountType
├── FIXED_AMOUNT → 显示 discountValue（标签：固定金额减免）
│               → 隐藏 maxDiscount
└── PERCENTAGE  → 显示 discountValue（标签：折扣百分比）
                → 显示 maxDiscount（最大折扣上限）
```

```typescript
{discountTypeNum === DISCOUNT_TYPE.PERCENTAGE && (
  <FormTextField name="maxDiscount" label={t('coupon.maxDiscount')} type="number" />
)}
```

**有效期类型联动**：

```
validType
├── RANGE          → 显示 validStartAt + validEndAt（日期选择器）
└── DAYS_AFTER_RECEIVE → 显示 validDays（整数输入）
```

```typescript
{validTypeNum === VALID_TYPE.DAYS_AFTER_RECEIVE && (
  <FormTextField name="validDays" label={t('coupon.validDays')} type="number" />
)}
{validTypeNum === VALID_TYPE.RANGE && (
  <>
    <FormDateField name="validStartAt" label={t('coupon.validStartDate')} />
    <FormDateField name="validEndAt" label={t('coupon.validEndDate')} />
  </>
)}
```

### 3.5 编辑模式数据回填

与 [`BannerFormModal`](./banner-management-form-modal.md) 不同，CouponModal 使用专门的转换函数进行回填：

```typescript
useEffect(() => {
  if (!editingData) return;
  const formData = transformPayloadToForm(editingData);
  form.reset(formData);
}, [editingData, form]);
```

⚠️ `form.reset` 不在依赖数组中——这是一个已知的 React Hook Form 模式，`form` 引用稳定不变，不需要作为依赖。

### 3.6 表单布局总览

```
CouponModal (2 列网格)
├── 第 1 行
│   ├── couponName (必填)        | couponCode (编辑时 disabled)
├── 第 2 行
│   ├── issueType (已发放则锁定)  | couponType (已发放则锁定)
├── 第 3 行
│   ├── discountType (已发放锁定) | discountValue (已发放锁定)
├── 第 4 行
│   ├── minPurchase (已发放锁定)  | [PERCENTAGE] maxDiscount (已发放锁定)
├── 第 5 行
│   ├── totalQuantity           | perUserLimit
├── 第 6 行
│   ├── validType (已发放锁定)   | [DAYS] validDays (已发放锁定) / [RANGE] validStartAt + validEndAt
├── 第 7 行 (col-span-2)
│   ├── subTitle (textarea)
├── 第 8 行 (col-span-2)
│   └── description (textarea)
└── 按钮区
    ├── Cancel (ghost)
    └── Save/Create (primary)
```

## 4. 创建与编辑的 Modal 管理

[`CouponList`](../../../apps/admin-next/src/views/Marketing/Coupon.tsx:133) 通过 [`ModalManager.open`](https://lucide.dev/icons) 管理弹窗生命周期：

```typescript
const handleOpenModal = useCallback((record?: Coupon) => {
  ModalManager.open({
    title: record ? t('coupon.editCoupon') : t('coupon.createCoupon'),
    renderChildren: ({ close, confirm }) => (
      <CouponModal
        t={t}
        editingData={record}
        close={close}
        confirm={() => {
          confirm();          // 关闭弹窗
          refresh();          // 刷新列表
          addToast('success', record ? t('coupon.updatedSuccess') : t('coupon.createdSuccess'));
        }}
      />
    ),
  });
}, [refresh, addToast, t]);
```

`handleOpenModal()` 无参数时创建新优惠券；传 `record` 时编辑已有优惠券。`editingData` 的有无驱动 CouponModal 内部的所有逻辑分支（标题、API 调用、字段锁定、数据回填）。

## 5. 设计模式总结

### 5.1 字段安全锁定策略

| 层面 | 措施 | 目的 |
|------|------|------|
| **UI 层** | `disabled` prop 灰显字段 | 用户提示 |
| **Payload 层** | `delete` 移除敏感字段 | 后端兼容 + 安全 |
| **API 层** | 后端校验 | 最终防御 |

### 5.2 条件联动模式对比

| 联动 | 监视字段 | 影响字段 | 实现方式 |
|------|---------|---------|---------|
| 折扣类型 | `discountType` | `maxDiscount` | `&&` 条件渲染 |
| 有效期类型 | `validType` | `validDays` / `validStartAt` / `validEndAt` | `&&` 条件渲染 |
| 发放数量 | `editingData.issuedQuantity` | 9 个敏感字段 | `disabled` + `delete` |
| 跳转类型 | `jumpCate` | `jumpUrl` / `relatedTitleId` | `useWatch` |

### 5.3 与 Finance 模块的组件差异

| 特性 | Finance (Withdrawal/Deposit) | Coupon |
|------|----------------------------|--------|
| 列表组件 | `SmartTable` | `BaseTable` + `SchemaSearchForm` |
| 数据获取 | `useRequest` + `requestWithdrawals` | `useAntdTable` |
| Column 定义 | `ProColumns` | `createColumnHelper` |
| 详情弹窗 | 独立 `DetailModal` | 无详情，表单即详情 |
| 删除确认 | 无 | `ModalManager` 内联确认 |

## 6. 总结

优惠券营销系统展示了电商后台中**配置密集型表单**的典型挑战。`CouponModal` 通过双向数据转换、字段安全锁定和条件联动的组合，处理了优惠券配置的复杂业务规则。`CouponList` 则通过进度条、颜色编码和 Badge 组合，在表格中高效呈现了丰富的优惠券信息。

从架构视角看，CouponList 使用了与 Finance 模块不同的组件栈（`BaseTable` + `useAntdTable`），说明了同一项目中允许**多种表格方案共存**——根据业务复杂度选择最合适的工具。

### 相关文章

- [`banner-management-form-modal.md`](./banner-management-form-modal.md) — Banner 表单的跳转联动
- [`finance-deposit-transaction-tracking.md`](./finance-deposit-transaction-tracking.md) — SmartTable 列表模式
- [`smart-table-generic-data-grid.md`](../admin/smart-table-generic-data-grid.md) — SmartTable 泛型表格对比
- [`server-prefetch-isr.md`](./server-prefetch-isr.md) — cache revalidation 机制
