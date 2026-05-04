# admin-next 商品 CRUD——CreateProductFormModal + EditProductFormModal：react-hook-form 多区段表单与图片上传

## 1. 背景

商品管理是电商后台的核心功能之一。一个完整的商品表单需要处理基础信息、价格体系、拼团配置、物流信息、富文本描述、封面图上传、赠品配置等多个维度。此外，创建和编辑两个场景共享同一套字段结构，但编辑时需要从已有商品数据回填。

[`CreateProductFormModal`](apps/admin-next/src/views/product/CreateProductFormModal.tsx:35)（440 行）和 [`EditProductFormModal`](apps/admin-next/src/views/product/EditProductFormModal.tsx:37)（446 行）实现了这一需求。两个组件共享约 85% 的代码结构，仅在数据初始化、图片预览和 API 调用上存在差异。

## 2. 架构概览

### 2.1 组件对比

| 维度 | [`CreateProductFormModal`](apps/admin-next/src/views/product/CreateProductFormModal.tsx:35) | [`EditProductFormModal`](apps/admin-next/src/views/product/EditProductFormModal.tsx:37) |
|------|------|------|
| Props | `categories` + `confirm` | `categories` + `confirm` + `product` |
| 数据获取 | 无，新建 | 从 `product` prop 反填 `defaultValues` |
| API 调用 | `productApi.createProduct(payload)` | `productApi.updateProduct(treasureId, payload)` |
| 图片预览 | 无 | `renderImage` → `<SmartImage>` 展示已有封面 |
| 默认值 | 全空/固定默认 | 从 `product` 对象回填 |

### 2.2 表单类型定义

两个组件共享同一个扩展类型：

```typescript
type ProductFormInputs = z.infer<typeof createProductSchema> & {
  bonusItemName?: string;
  bonusItemImg?: string | File;
  bonusWinnerCount?: number;
};
```

使用类型交叉（`&`）扩展 Zod schema，因为赠品字段不在 `createProductSchema` 中定义，而是由组件自行管理。

### 2.3 Props 接口

```typescript
// Create
interface CreateProductFormModalProps {
  categories: Category[];  // 分类选项
  confirm: () => void;     // 成功后关闭并刷新
}

// Edit
interface EditProductFormModalProps {
  categories: Category[];
  confirm: () => void;
  product: Product;        // 已有商品数据
}
```

## 3. 表单布局——双列网格

两个组件使用相同的两列布局：

```typescript
<div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-6">
```

- **左列（`1.4fr`）**：主要表单字段区，包含 6 个分组
- **右列（`1fr`）**：封面图上传 + 赠品配置，`sticky top-0` 固定

外层容器 `h-[650px] overflow-y-auto scrollbar-thin` 控制整体滚动。

## 4. 表单字段分组

### 4.1 基础信息

```
┌──────────────────────────────────────┐
│ 📦 Basic Information                 │
│ ┌────────────────────────────────┐   │
│ │ Product Name                   │   │
│ └────────────────────────────────┘   │
│ ┌──────────────┬─────────────────┐   │
│ │ Category     │ Stock (Shares)  │   │
│ └──────────────┴─────────────────┘   │
└──────────────────────────────────────┘
```

- `treasureName`：文本输入
- `categoryIds`：`FormSelectField`，选项来自 `categories.map(c => ({ label: c.name, value: String(c.id) }))`
- `seqShelvesQuantity`：数字输入（库存份数）

### 4.2 价格体系（绿色背景）

```
┌──────────────────────────────────────┐
│ 💰 Price Structure  (bg-green-50)    │
│ ┌──────────────┬─────────────────┐   │
│ │ Group Price  │ Cost            │   │
│ │ (Main, ₱)    │ (₱)             │   │
│ ├──────────────┼─────────────────┤   │
│ │ Solo Price   │ MSRP            │   │
│ │ (Optional)   │ (Optional)      │   │
│ └──────────────┴─────────────────┘   │
└──────────────────────────────────────┘
```

价格字段使用 `renderRight` 渲染货币符号 ₱：

```typescript
<FormTextField
  name="unitAmount"
  label="Group Price (Main)"
  type="number"
  renderRight={() => <span className="text-xs text-gray-500">₱</span>}
/>
```

`marketAmount` 和 `soloAmount` 是可选的，提交时需做空值判断：

```typescript
marketAmount:
  values.marketAmount !== undefined && values.marketAmount !== null
    ? Number(values.marketAmount)
    : undefined,
```

### 4.3 拼团与自动化（蓝色背景）

```
┌──────────────────────────────────────┐
│ 🤖 Group & Automation (bg-blue-50)  │
│ ┌──────────────┬─────────────────┐   │
│ │ Group Size   │ Time Limit (Sec)│   │
│ └──────────────┴─────────────────┘   │
│ ─────────────────────────────────── │
│ ☑ Enable Robot Auto-fill            │
│ ┌────────────────────────────────┐   │
│ │ Robot Delay (Sec) [conditional]│   │
│ └────────────────────────────────┘   │
│ ┌────────────────────────────────┐   │
│ │ Group Leader Bonus             │   │
│ └────────────────────────────────┘   │
└──────────────────────────────────────┘
```

**条件渲染**：`enableRobot` 为 `true` 时才显示 `robotDelay` 字段：

```typescript
const enableRobot = form.watch('enableRobot');

{enableRobot && (
  <div className="flex-1">
    <FormTextField name="robotDelay" label="Robot Delay (Sec)" type="number" />
  </div>
)}
```

**团长奖励**：使用 `FormSelectField` 提供三种选项——None / Free Order（免单）/ Commission（佣金）。

### 4.4 销售时间

```typescript
<FormDateField name="salesStartAt" label="Start Time" />
<FormDateField name="salesEndAt" label="End Time" />
```

提交时将 Date 对象转为时间戳：

```typescript
salesStartAt: values.salesStartAt
  ? new Date(values.salesStartAt).getTime()
  : undefined,
```

### 4.5 物流

```typescript
<FormSelectField
  name="shippingType"
  options={[
    { label: 'Physical Shipping', value: '1' },
    { label: 'No Shipping', value: '2' },
  ]}
/>
<FormTextField name="weight" label="Weight (kg)" type="number" />
```

### 4.6 富文本描述

使用 [`FormRichTextField`](apps/admin-next/src/views/product/CreateProductFormModal.tsx:17) 组件，配合自定义上传回调：

```typescript
const handleEditorUpload = async (file: File): Promise<string> => {
  const res = await upload.runAsync(file);
  return res.url;
};

<FormRichTextField
  name="desc"
  label="Product Details"
  onUpload={handleEditorUpload}
/>
<FormRichTextField
  name="ruleContent"
  label="Rules & Terms"
  onUpload={handleEditorUpload}
/>
```

## 5. 右侧 Sticky 面板——图片与赠品

### 5.1 封面图上传

```typescript
<FormMediaUploaderField
  name="treasureCoverImg"
  label="Cover Image"
  maxFileCount={1}
/>
```

在编辑模式下，额外提供 `renderImage` 以显示已有的封面图片：

```typescript
// EditProductFormModal 特有
renderImage={({ src, alt, className }) => (
  <SmartImage
    src={src}
    alt={alt}
    width={400}
    height={400}
    className={className}
    imgClassName="w-64 h-64 rounded-md object-cover"
    layout="constrained"
  />
)}
```

### 5.2 赠品配置（黄色边框）

```
┌──────────────────────────────────────┐
│ 🎁 Bonus Prize (border-yellow-200)   │
│ ┌────────────────────────────────┐   │
│ │ Item Name                      │   │
│ └────────────────────────────────┘   │
│ ┌────────────────────────────────┐   │
│ │ Winners Count                  │   │
│ └────────────────────────────────┘   │
│ ┌────────────────────────────────┐   │
│ │ Prize Image                    │   │
│ └────────────────────────────────┘   │
└──────────────────────────────────────┘
```

## 6. 提交逻辑——Payload 构建

`onSubmit` 处理流程分三步：

### 6.1 图片上传处理

```typescript
// 1. 处理封面图上传
let coverUrl: string = '';
if (values.treasureCoverImg instanceof File) {
  const res = await upload.runAsync(values.treasureCoverImg);
  coverUrl = res.url;
} else {
  coverUrl = values.treasureCoverImg as string; // 已有 URL
}

// 2. 处理赠品图上传
let bonusImgUrl: string = '';
if (values.bonusItemImg instanceof File) {
  const res = await upload.runAsync(values.bonusItemImg);
  bonusImgUrl = res.url;
} else if (typeof values.bonusItemImg === 'string') {
  bonusImgUrl = values.bonusItemImg;
}
```

`instanceof File` 是关键的运行时类型守卫：如果用户上传了新图片，值是 `File` 对象，需要先上传获取 URL；如果用户未更换图片，值已经是 URL 字符串，直接使用。

### 6.2 价格空值保护

```typescript
marketAmount:
  values.marketAmount !== undefined && values.marketAmount !== null
    ? Number(values.marketAmount)
    : undefined,
```

可选价格字段（`marketAmount`、`soloAmount`）需要区分"用户未填写"和"用户填写了 0"，避免将 `undefined` 或 `null` 作为 0 发送到后端。

### 6.3 赠品配置条件构建

```typescript
bonusConfig: values.bonusItemName
  ? {
      bonusItemName: values.bonusItemName,
      bonusItemImg: bonusImgUrl,
      winnerCount: Number(values.bonusWinnerCount || 1),
      allowRobot: true,
    }
  : undefined,
```

只有当 `bonusItemName` 有值时，才构建 `bonusConfig` 对象，否则传 `undefined`。

### 6.4 完整 Payload 结构

```typescript
const payload: CreateProduct = {
  treasureName, seqShelvesQuantity,
  categoryIds: [Number(values.categoryIds)],
  treasureCoverImg: coverUrl,
  desc, ruleContent,
  // 价格
  unitAmount: Number(values.unitAmount),
  costAmount: Number(values.costAmount),
  marketAmount: 可选 ? Number : undefined,
  soloAmount: 可选 ? Number : undefined,
  // 物流
  shippingType: Number(values.shippingType),
  weight: Number(values.weight),
  // 拼团
  groupSize: Number(values.groupSize),
  groupTimeLimit: Number(values.groupTimeLimit),
  enableRobot: Boolean(values.enableRobot),
  robotDelay: values.robotDelay ? Number(values.robotDelay) : 300,
  leaderBonusType: Number(values.leaderBonusType || 0),
  // 时间
  salesStartAt: values.salesStartAt ? new Date(values.salesStartAt).getTime() : undefined,
  salesEndAt: values.salesEndAt ? new Date(values.salesEndAt).getTime() : undefined,
  // 赠品
  bonusConfig: values.bonusItemName ? { ... } : undefined,
};
```

### 6.5 错误处理

```typescript
try {
  await createProduct(payload);  // 或 updateProduct(product.treasureId, payload)
} catch (e) {
  const status = (e as { response?: { status?: number } })?.response?.status;
  if (!status || status < 400 || status >= 500) console.error(e);
  addToast('error', 'Failed to save product');
}
```

- 4xx 状态码由 HTTP 拦截器统一处理，组件不重复 toast
- 非 4xx 或未知错误打印到 console
- 始终显示失败 toast（作为兜底反馈）

## 7. 创建 vs 编辑——默认值差异

### 7.1 Create 默认值

```typescript
defaultValues: {
  treasureName: '',
  seqShelvesQuantity: 0,
  unitAmount: 0,
  costAmount: 0,
  marketAmount: undefined,
  soloAmount: undefined,
  groupSize: 5,
  groupTimeLimit: 86400,   // 24 小时
  enableRobot: false,
  robotDelay: 300,
  salesStartAt: undefined,
  salesEndAt: undefined,
  bonusItemName: '',
  bonusWinnerCount: 1,
  leaderBonusType: 0,
}
```

### 7.2 Edit 默认值（从 product 回填）

```typescript
defaultValues: {
  treasureName: product.treasureName,
  seqShelvesQuantity: product.seqShelvesQuantity,
  categoryIds: product.categories?.[0]?.categoryId,  // 取第一个分类
  treasureCoverImg: product.treasureCoverImg,
  unitAmount: product.unitAmount,
  costAmount: product.costAmount,
  marketAmount: product.marketAmount,
  // ...
  enableRobot: product.enableRobot ?? false,
  robotDelay: product.robotDelay ?? 300,
  salesStartAt: product.salesStartAt
    ? new Date(product.salesStartAt)  // 时间戳 → Date 对象
    : undefined,
  salesEndAt: product.salesEndAt ? new Date(product.salesEndAt) : undefined,
  bonusItemName: bonusConfig?.bonusItemName || '',
  bonusItemImg: bonusConfig?.bonusItemImg || '',
}
```

关键转换：
- `categoryIds`：从 `categories[0].categoryId` 取（商品关联的第一分类）
- `salesStartAt / salesEndAt`：时间戳转 Date（`FormDateField` 需要 Date 类型）
- `bonusItemImg`：已有 URL 字符串，无需重新上传
- `product.groupSize ?? 5`：使用 `??` 回退默认值，避免 `0` 被覆盖

## 8. 图片上传架构

```
┌─────────────────────────────────────────────────────┐
│  handleEditorUpload (富文本图片)                      │
│  ┌─────────┐    upload.runAsync(file)    ┌────────┐ │
│  │ 用户选图 │ ─────────────────────────→ │ 服务端  │ │
│  └─────────┘                             └────────┘ │
│       │                                   return url│
│       └─────────────────────────────────────────────│
│                     插入编辑器                        │
├─────────────────────────────────────────────────────┤
│  onSubmit (封面/赠品图)                               │
│  ┌─────────┐                                        │
│  │ File     │ → upload.runAsync → url               │
│  │ String   │ → 直接使用                             │
│  └─────────┘                                        │
└─────────────────────────────────────────────────────┘
```

两个上传通道：
1. **富文本编辑器**：`handleEditorUpload` 返回 Promise\<string\>，插入编辑器内容
2. **表单提交**：`instanceof File` 判断后决定上传或直接使用

## 9. 状态管理

| useRequest | 用途 | 触发方式 |
|-----------|------|---------|
| `createProduct` / `updateProduct` | 创建/更新商品 | `manual: true`，表单提交时触发 |
| `upload` | 图片上传 | `manual: true`，上传按钮点击或表单提交时触发 |

提交按钮的 loading 状态合并两个请求：

```typescript
<Button isLoading={loading || upload.loading} type="submit">
  Create Product  {/* 或 Confirm Update */}
</Button>
```

## 10. 设计要点总结

1. **创建与编辑共享同一套组件模式**：react-hook-form + zodResolver + @repo/ui Form 字段组件，差异通过 Props 控制
2. **多区段视觉分组**：不同背景色（绿色=价格、蓝色=拼团、灰色=物流、黄色=赠品）帮助运营人员快速定位
3. **条件字段渲染**：`form.watch('enableRobot')` 控制 robotDelay 显示，减少不必要字段
4. **图片上传的运行时类型守卫**：`instanceof File` 判断用户是否上传了新图片，避免重复上传已有 URL
5. **价格空值保护**：可选价格字段使用 `!== undefined && !== null` 判断，不将空值转换为 0
6. **赠品配置条件构建**：仅当填写了赠品名称时才发送 bonusConfig，避免空配置
7. **编辑回填的日期转换**：时间戳 → Date 对象，适配 FormDateField 的类型要求
8. **sticky 侧栏**：右侧图片和赠品区域固定在视口内，长表单滚动时不消失

## 11. 完整数据流

```
创建流程:
  ModalManager.open({ renderChildren: CreateProductFormModal })
  → react-hook-form 初始化（空默认值）
  → 用户填写表单
  → onSubmit:
    1. instanceof File → 上传封面图 → 获取 URL
    2. instanceof File → 上传赠品图 → 获取 URL
    3. 组装 payload（价格空值保护 + bonusConfig 条件）
    4. productApi.createProduct(payload)
    5. onSuccess → confirm() → 关闭弹窗 + 刷新列表

编辑流程:
  ModalManager.open({ renderChildren: EditProductFormModal })
  → defaultValues 从 product prop 回填
  → 用户修改表单
  → onSubmit:
    1. 同上图片处理
    2. productApi.updateProduct(treasureId, payload)
    3. onSuccess → confirm() → 关闭弹窗 + 刷新列表
```

## 12. 总结

[`CreateProductFormModal`](apps/admin-next/src/views/product/CreateProductFormModal.tsx:35) 和 [`EditProductFormModal`](apps/admin-next/src/views/product/EditProductFormModal.tsx:37) 是典型的"同一表单、两种模式"的实现。通过 react-hook-form 的 `defaultValues` 驱动、`instanceof File` 运行时类型守卫处理图片上传、以及条件字段渲染，在 440+ 行内完成了包含 6 个分组、2 个富文本编辑器、图片上传和赠品配置的复杂商品表单。

### 相关文章

- [Banner 管理——FormModal + BindProduct](banner-management-form-modal.md)
- [优惠券营销系统——CouponModal 条件表单](coupon-marketing-system.md)
- [UI 组件库——FormTextField、FormSelectField、FormRichTextField 等](ui-components-library.md)
- [SmartTable——泛型智能表格](smart-table-generic-data-grid.md)
