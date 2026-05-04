---
title: "admin-next Banner 管理——BannerFormModal 表单智能跳转 + BannerBindProduct 产品选择器"
slug: "banner-management-form-modal"
date: "2026-05-03"
description: "深入分析 admin-next 中 Banner 表单弹窗的智能跳转联动机制、文件上传处理策略以及内嵌产品选择器的 @tanstack/react-table 实现"
tags: ["admin-next", "React", "Banner", "react-hook-form", "tanstack-table", "conditional-rendering"]
---

# admin-next Banner 管理——BannerFormModal 表单智能跳转 + BannerBindProduct 产品选择器

## 1. 背景

Banner（横幅广告）管理是电商后台的常见功能模块。与简单的 CRUD 不同，Banner 的核心复杂之处在于**跳转逻辑**——运营人员需要配置 Banner 点击后的行为：无操作、跳转商品详情、或跳转外部链接。此外，Banner 还涉及图片上传、位置排期、排序等多维度配置。

本篇分析 [`BannerFormModal.tsx`](../../../apps/admin-next/src/views/banner/BannerFormModal.tsx)（248 行）和 [`BannerBindProduct.tsx`](../../../apps/admin-next/src/views/banner/BannerBindProduct.tsx)（237 行）两个核心组件，分别负责 Banner 表单弹窗的**智能跳转联动**和**产品搜索选择器**。

## 2. BannerFormModal——智能跳转表单弹窗

### 2.1 组件 Props

[`BannerFormModal`](../../../apps/admin-next/src/views/banner/BannerFormModal.tsx:33) 接受四个 props：

```typescript
interface Props {
  close: () => void;
  confirm: () => void;
  editingData?: Banner;   // 编辑模式时传入，创建模式为 undefined
  defaultCate?: number;   // 当前所在的 Tab
  t: TFunc;               // 国际化翻译函数
}
```

`editingData` 的有无决定了表单的工作模式——创建还是编辑。所有 props 中未出现类似 `bannerApi` 的调用，API 完全通过 `@/api` 模块的 `bannerApi` / `uploadApi` 在组件内部调用。

### 2.2 表单初始化与 Zod 校验

表单使用 [`react-hook-form`](https://react-hook-form.com/) 的 [`useForm`](https://react-hook-form.com/docs/useform) + [`zodResolver`](https://github.com/colinhacks/zod) 双剑合璧：

```typescript
const form = useForm<BannerFormInputs>({
  resolver: zodResolver(BannerShema),
  defaultValues: {
    title: '',
    bannerImgUrl: '',
    fileType: 1,
    bannerCate: 0,
    jumpCate: 0,
    sortOrder: 0,
    activityAtStart: undefined,
    activityAtEnd: undefined,
    relatedTitleId: undefined,
  },
});
```

`BannerShema` 是定义在 [`@/schema/bannerShema`](../../../apps/admin-next/src/schema/bannerShema.ts) 的 Zod schema，覆盖所有字段的验证规则。

### 2.3 编辑模式数据回填

通过 [`useEffect`](https://react.dev/reference/react/useEffect) + [`form.reset`](https://react-hook-form.com/docs/useform/reset) 实现编辑模式的数据回填：

```typescript
useEffect(() => {
  if (editingData) {
    form.reset({
      ...editingData,
      activityAtStart: editingData.activityAtStart
        ? new Date(editingData.activityAtStart)
        : undefined,
      activityAtEnd: editingData.activityAtEnd
        ? new Date(editingData.activityAtEnd)
        : undefined,
      // ... 其他字段映射
    });
  }
}, [editingData, form, form.reset]);
```

关键转换：`activityAtStart` / `activityAtEnd` 从后端返回的 ISO 字符串转为 `Date` 对象，以适配 `FormDateField` 组件。

### 2.4 文件上传策略

表单提交时，需要判断 `bannerImgUrl` 的类型：

```typescript
const { run: submit, loading } = useRequest(
  async (values) => {
    let bannerImgUrl: string;
    if (values.bannerImgUrl instanceof File) {
      const { url } = await uploadApi.uploadMedia(values.bannerImgUrl);
      bannerImgUrl = url;
    } else {
      bannerImgUrl = values.bannerImgUrl;
    }
    const payload = { ...values, bannerImgUrl };

    if (editingData) {
      return bannerApi.update(editingData.id, payload);
    }
    return bannerApi.create(payload);
  },
  { manual: true, onSuccess: () => { /* toast + confirm */ } },
);
```

这解决了一个常见问题：**图片字段的双重身份**。在创建时，用户上传新文件（`File` 对象）；在编辑时，字段值是已有的 URL 字符串（`string`）。通过 `instanceof File` 运行时检查，决定是否需要先上传到媒体服务器。

### 2.5 表单布局结构

表单分为三个逻辑区域，以注释清晰分隔：

#### 2.5.1 基础视觉区

```typescript
<div className="grid grid-cols-1 gap-4">
  <FormTextField name="title" label={t('banners_formTitle')} required />
  <FormMediaUploaderField
    required
    maxFileCount={1}
    name="bannerImgUrl"
    label={t('banners_formCreativeAsset')}
    renderImage={({ src, alt, className }) => (
      <SmartImage src={src} alt={alt} width={614} height={300}
        className={className}
        imgClassName="w-[614px] h-[300px] rounded-md object-cover"
        layout="constrained"
      />
    )}
  />
</div>
```

`FormMediaUploaderField` 使用 [`SmartImage`](https://unpic.dev/) 组件渲染固定尺寸（614×300）的 Banner 预览，`layout="constrained"` 确保比例自适应。

#### 2.5.2 位置与排期

```typescript
<div className="grid grid-cols-2 gap-4">
  <FormSelectField name="bannerCate" label={t('banners_formPosition')}
    numeric options={[
      { label: t('banners_positionHome'), value: '1' },
      { label: t('banners_positionActivity'), value: '2' },
      { label: t('banners_positionProduct'), value: '3' },
    ]}
  />
  <FormTextField name="sortOrder" label={t('banners_formSortOrder')} type="number" />
</div>
<div className="grid grid-cols-2 gap-4">
  <FormDateField name="activityAtStart" label={t('banners_formStartTime')} />
  <FormDateField name="activityAtEnd" label={t('banners_formEndTime')} />
</div>
```

`numeric={true}` 确保选择框的值以数字类型提交，而非字符串。

#### 2.5.3 智能跳转配置区（核心）

这是整个表单最复杂的部分，使用 [`useWatch`](https://react-hook-form.com/docs/usecontroller/usewatch) 实现**响应式条件渲染**：

```typescript
const jumpCate = useWatch({ control: form.control, name: 'jumpCate' });
```

`jumpCate` 的值变化会实时触发 UI 重渲染，无需手动提交。

### 2.6 条件渲染策略

智能跳转区包含三种状态，根据 `JUMP_CATE` 枚举值切换：

```typescript
enum JUMP_CATE {
  NONE = 0,       // 无跳转
  TREASURE = 1,   // 跳转商品详情
  EXTERNAL = 2,   // 跳转外部链接
}
```

#### 选择无跳转

仅显示跳转类型选择器，无额外配置项。

#### 跳转外部链接

当 `Number(jumpCate) === JUMP_CATE.EXTERNAL` 时，出现 URL 输入框：

```typescript
{Number(jumpCate) === JUMP_CATE.EXTERNAL && (
  <div className="animate-in fade-in slide-in-from-top-2">
    <FormTextField
      name="jumpUrl"
      label={t('banners_formTargetUrl')}
      renderLeft={() => <Link size={16} className="mr-2 text-gray-400" />}
    />
  </div>
)}
```

- 使用 [`animate-in`](https://www.tailwindcss-animated.com/) CSS 动画实现平滑出现
- `Link` 图标来自 [`lucide-react`](https://lucide.dev/icons/link)

#### 跳转商品详情

当 `Number(jumpCate) === JUMP_CATE.TREASURE` 时，通过 [`Controller`](https://react-hook-form.com/docs/usecontroller/controller) 包裹 `BannerBindProduct` 组件：

```typescript
{Number(jumpCate) === JUMP_CATE.TREASURE && (
  <Controller
    name="relatedTitleId"
    render={({ field, fieldState }) => (
      <div>
        <BannerBindProduct value={field.value} onChange={field.onChange} t={t} />
        {fieldState.error && (
          <div className="mt-1 text-sm text-red-500">{fieldState.error.message}</div>
        )}
      </div>
    )}
  />
)}
```

使用 `Controller` 而非直接在 `BannerBindProduct` 中使用 `useForm` context，原因有二：
1. `BannerBindProduct` 是一个**独立复用组件**，不应耦合于父表单的 `useForm` 实例
2. `Controller` 提供了标准的 `value` / `onChange` 接口，便于组件解耦

### 2.7 条件渲染关系图

```
BannerFormModal
├── 基础视觉区
│   ├── title (FormTextField)
│   └── bannerImgUrl (FormMediaUploaderField)
├── 位置与排期
│   ├── bannerCate (FormSelectField: Home/Activity/Product)
│   ├── sortOrder (FormTextField: number)
│   ├── activityAtStart (FormDateField)
│   └── activityAtEnd (FormDateField)
└── 智能跳转配置区（虚线边框容器）
    ├── jumpCate (FormSelectField: None/Product/External)
    ├── [jumpCate === EXTERNAL] → jumpUrl (FormTextField + Link icon)
    └── [jumpCate === TREASURE] → BannerBindProduct
        └── 产品搜索表格选择器
```

## 3. BannerBindProduct——产品搜索选择器

[`BannerBindProduct`](../../../apps/admin-next/src/views/banner/BannerBindProduct.tsx:38) 是一个独立的产品选择器组件，与 BannerFormModal 通过 `value` / `onChange` 接口解耦。

### 3.1 组件接口

```typescript
interface Props {
  value?: string;           // 当前选中的产品 ID
  onChange?: (value: string) => void;   // 选中回调
  t: TFunc;                 // 国际化
}
```

采用受控组件模式，父组件通过 `value` 传入当前选中值，通过 `onChange` 接收选择变更。

### 3.2 搜索与数据加载

组件使用 [`useAntdTable`](https://ahooks.js.org/hooks/use-antd-table) 管理产品列表的分页搜索：

```typescript
const [searchTerm, setSearchTerm] = useState('');

const getTableData = useCallback(
  async ({ current, pageSize }, formData: { name: string }) => {
    const res = await productApi.getProducts({
      page: current, pageSize, treasureName: formData.name,
    });
    return { list: res.list ?? [], total: res.total ?? 0 };
  }, [],
);

const { tableProps, run } = useAntdTable(getTableData, {
  manual: true, defaultPageSize: 5,
  defaultParams: [{ current: 1, pageSize: 5 }, { name: '' }],
});

useEffect(() => {
  run({ current: 1, pageSize: 5 }, { name: searchTerm });
}, [run, searchTerm]);
```

搜索触发方式：
1. **输入即时触发**：`searchTerm` 状态变化触发 `useEffect`，自动调用 `run()`
2. **回车触发**：`onKeyDown` 检测 `Enter` 键
3. **按钮触发**：搜索按钮显式调用 `run()`

### 3.3 @tanstack/react-table 列定义

列定义使用 [`createColumnHelper`](https://tanstack.com/table/v8/docs/api/core/column-helper) 的链式 API：

```typescript
const columns = useMemo(() => {
  const columnHelper = createColumnHelper<Product>();
  return [
    columnHelper.display({
      id: 'select',
      header: t('banners_select'),
      cell: (info) => {
        const meta = info.table.options.meta as TableMeta;
        const { relatedTitleId, setRelatedTitleId } = meta;
        const id = info.row.original.treasureId;
        const isChecked = relatedTitleId === id;
        return (
          <div onClick={() => setRelatedTitleId(id)}
            className={`aspect-square h-4 w-4 rounded-full border ... ${isChecked ? 'border-primary' : 'border-gray-400'}`}>
            {isChecked && <div className="h-2.5 w-2.5 rounded-full bg-primary" />}
          </div>
        );
      },
    }),
    columnHelper.accessor('treasureName', {
      header: t('banners_productInfo'),
      cell: (info) => (
        <div className="flex items-center gap-3">
          <Image src={info.row.original.treasureCoverImg} width={40} height={40}
            className="w-10 h-10 rounded object-cover" alt="" loading="lazy" />
          <div className="text-sm font-medium line-clamp-1">{info.getValue()}</div>
        </div>
      ),
    }),
    columnHelper.accessor('unitAmount', {
      header: t('banners_price'),
      cell: (info) => <span className="font-mono text-xs">₱{info.getValue()}</span>,
    }),
  ];
}, [t]);
```

三种列类型：
1. **选择列**（`display`）：自定义 Radio 样式，纯 CSS 实现圆形选中态
2. **产品信息列**（`accessor`）：缩略图 + 产品名称
3. **价格列**（`accessor`）：等宽字体显示比索金额

### 3.4 Table Meta——状态传递的关键模式

组件通过 [`meta`](https://tanstack.com/table/v8/docs/api/core/table#meta) 将受控组件的 `value` 和 `onChange` 注入表格：

```typescript
interface TableMeta {
  relatedTitleId: string | null;
  setRelatedTitleId: (id: string) => void;
}

const table = useReactTable({
  data: (tableProps.dataSource || []) as Product[],
  columns,
  getCoreRowModel: getCoreRowModel(),
  getRowId: (row) => row.treasureId,
  meta: {
    relatedTitleId: value || null,
    setRelatedTitleId: (id: string) => onChange?.(id),
  } as TableMeta,
});
```

这样做的好处是：**避免列回调闭包捕获过时值**。由于 `columns` 通过 `useMemo` 缓存，如果直接在列定义中引用 `value` / `onChange`，会形成闭包陷阱。通过 `meta` 传递，每次渲染时 `meta` 都拿到最新值。

### 3.5 分页控件

组件使用自定义分页（非 TanStack Table 内置分页），适配 `useAntdTable` 的 `tableProps.pagination`：

```typescript
<div className="flex gap-2">
  <Button size="sm" variant="outline"
    disabled={tableProps.pagination.current === 1}
    onClick={() => tableProps.pagination.onChange(tableProps.pagination.current - 1, 5)}>
    {t('banners_prev')}
  </Button>
  <Button size="sm" variant="outline"
    disabled={tableProps.pagination.current * 5 >= tableProps.pagination.total}
    onClick={() => tableProps.pagination.onChange(tableProps.pagination.current + 1, 5)}>
    {t('banners_next')}
  </Button>
</div>
```

每页固定显示 5 条，通过 `tableProps.pagination` 的 `current` / `total` / `onChange` 标准化接口驱动。

### 3.6 UI 布局

组件以浮动弹窗卡片形式呈现：

```typescript
<div className="rounded-xl shadow-2xl w-[600px] max-w-[90vw] flex flex-col max-h-[85vh]">
```

- 固定宽度 600px，移动端缩放到 90vw
- `max-h-[85vh]` 限制最大高度，超出滚动
- `rounded-xl` + `shadow-2xl` 营造"浮层"视觉

## 4. 设计模式总结

### 4.1 条件渲染的三种实现

| 模式 | 使用场景 | 技术方案 |
|------|---------|---------|
| 简单显示/隐藏 | URL 输入框 | `&&` 运算符 + CSS 动画 |
| 受控组件桥接 | BannerBindProduct | `Controller` + `field.onChange` |
| 字段值联动 | jumpCate 选择 | `useWatch` 响应式订阅 |

### 4.2 文件上传的透明处理

`bannerImgUrl` 字段在表单中统一为 `string | File` 类型，提交时通过 `instanceof File` 判断是否需要上传。这种**透明上传**模式避免了运营人员感知后端存储细节。

### 4.3 组件解耦的三种策略

1. **Props 接口**：`BannerBindProduct` 通过 `value` / `onChange` 受控接口与父组件解耦
2. **Table Meta**：使用 `@tanstack/react-table` 的 `meta` 机制传递回调，避免列闭包陷阱
3. **独立 API 调用**：`BannerFormModal` 直接调用 `bannerApi` 和 `uploadApi`，不依赖父组件

### 4.4 编辑/创建复用

一个组件同时处理创建和编辑两种模式：
- `editingData` 决定 API 调用路径（`bannerApi.create` vs `bannerApi.update`）
- `useEffect` + `form.reset` 回填编辑数据
- `Date` 类型转换在回填时处理

## 5. 总结

Banner 表单管理的技术亮点在于**智能跳转的条件渲染联动**和**产品选择器的组件解耦设计**。`useWatch` 驱动的实时 UI 切换让运营人员能直观地配置 Banner 点击行为；`BannerBindProduct` 通过 `value` / `onChange` + `@tanstack/react-table` 的 `meta` 机制，实现了与父表单的干净解耦。

从架构视角看，`BannerFormModal` 遵循了整个 admin-next 表单的通用模式：`react-hook-form` + Zod 校验 + `useRequest` 异步提交 + `@repo/ui` 表单字段组件。这与财务审核工作量中的 [`WithdrawAuditModal`](./finance-audit-withdrawal-adjust-workflow.md) 和 [`ManualAdjustModal`](./finance-audit-withdrawal-adjust-workflow.md) 共享相同的底层基础设施。

### 相关文章

- [`finance-audit-withdrawal-adjust-workflow.md`](./finance-audit-withdrawal-adjust-workflow.md) — 表单弹窗 + useRequest 提交模式
- [`finance-deposit-transaction-tracking.md`](./finance-deposit-transaction-tracking.md) — SmartTable 列表模式
- [`ui-components-library.md`](./ui-components-library.md) — FormTextField / FormSelectField / FormDateField 等表单组件
