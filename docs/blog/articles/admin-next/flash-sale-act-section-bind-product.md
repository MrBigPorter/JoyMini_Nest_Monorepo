# admin-next 限时抢单与活动专区绑定——FlashSaleBindProductModal + ActSectionBindProductModal + ProductSelectorModal

## 1. 背景

在电商后台中，"限时抢单"（Flash Sale）和"活动专区"（Act Section）是两种常见的营销手段。它们都需要将商品绑定到特定活动时段或专区中，但绑定逻辑存在显著差异：

- **限时抢单**：每次绑定单个商品，且需要额外填写活动价和抢单库存
- **活动专区**：支持批量多选绑定商品，单个商品也可行内绑定/解绑

这两个功能由三个组件实现：

| 组件 | 文件 | 行数 | 职责 |
|------|------|------|------|
| [`FlashSaleBindProductModal`](apps/admin-next/src/views/flash-sale/FlashSaleBindProductModal.tsx:27) | `views/flash-sale/` | 296 行 | 限时抢单单品绑定，附带价格/库存填写 |
| [`ActSectionBindProductModal`](apps/admin-next/src/views/act-section/ActSectionBindProductModal.tsx:23) | `views/act-section/` | 263 行 | 活动专区批量绑定，多选 + 行内操作 |
| [`ProductSelectorModal`](apps/admin-next/src/views/act-section/ProductSelectorModal.tsx:31) | `views/act-section/` | 187 行 | 活动专区创建/编辑表单 |

## 2. 架构对比：两个 BindProductModal

### 2.1 Props 对比

| 参数 | [`FlashSaleBindProductModal`](apps/admin-next/src/views/flash-sale/FlashSaleBindProductModal.tsx:27) | [`ActSectionBindProductModal`](apps/admin-next/src/views/act-section/ActSectionBindProductModal.tsx:23) |
|------|------|------|
| 数据标识 | `sessionId: string` | `editingData: actSectionWithProducts` |
| 关闭回调 | `onClose: () => void` | `onClose: () => void` |
| 确认回调 | `onSaved: () => void` | `onConfirm: () => void` |
| 翻译 | 内部 `useTranslation()` | 外部传入 `t: TFunc` |

### 2.2 绑定模式对比

| 维度 | Flash Sale | Act Section |
|------|-----------|-------------|
| 选择方式 | 单选（`pending` state） | 多选（`selectedRows` + checkbox） |
| 绑定时机 | 先选择 → 填写价格/库存 → 确认绑定 | 批量选择 → 一键确认 或 行内即时绑定 |
| 解绑方式 | 行内按钮，直接调用 API | 行内按钮，先弹确认对话框再解绑 |
| 已绑标识 | `boundIds` 数组跟踪 | `existingIds` 数组跟踪 |
| 额外参数 | `flashPrice` + `flashStock` | 无 |

## 3. FlashSaleBindProductModal（限时抢单绑定）

### 3.1 状态管理

```
┌───────────────────────────────────────────────┐
│  State                                        │
│  ┌──────────────┐  ┌──────────────────────┐   │
│  │ boundIds[]   │  │ pending: Product|null │   │
│  │ 已绑定的     │  │ 当前待确认的商品     │   │
│  │ treasureId   │  │                      │   │
│  └──────────────┘  └──────────────────────┘   │
│  ┌──────────────┐  ┌──────────────────────┐   │
│  │ flashPrice   │  │ flashStock           │   │
│  │ 活动价输入   │  │ 抢单库存输入         │   │
│  └──────────────┘  └──────────────────────┘   │
│  ┌──────────────┐                              │
│  │ searchTerm   │                              │
│  └──────────────┘                              │
└───────────────────────────────────────────────┘
```

### 3.2 数据流

```typescript
// 1. 初始化：拉取已绑定商品
const { run: fetchBound } = useRequest(
  () => flashSaleApi.getSessionProducts(sessionId),
  {
    onSuccess: (data) => {
      const ids = (data?.list ?? []).map((p) => p.treasureId);
      setBoundIds(ids);
    },
  },
);

// 2. 商品分页：useAntdTable
const getTableData = useCallback(
  async ({ current, pageSize }, formData) => {
    const res = await productApi.getProducts({
      page: current, pageSize,
      treasureName: formData.name,
    });
    return { list: res.list ?? [], total: res.total ?? 0 };
  },
  [],
);
const { tableProps, run } = useAntdTable(getTableData, { manual: true, defaultPageSize: 5 });
```

### 3.3 列定义

三列结构，使用 `@tanstack/react-table` 的 `createColumnHelper`：

| 列 | 渲染 | 说明 |
|----|------|------|
| Product | `SmartImage` + 商品名 `line-clamp-2` | 左图右文 |
| Original Price | `₱{unitAmount}` | `font-mono` 等宽字体 |
| Action | 已绑→`Link2Off` 解绑 / 未绑→`Link` 选择 | 根据 `boundIds.includes()` 判断 |

```typescript
col.accessor((row) => boundIds.includes(row.treasureId), {
  id: 'actions',
  cell: (info) => {
    const isBound = boundIds.includes(info.row.original.treasureId);
    const isSelected = pending?.treasureId === info.row.original.treasureId;
    return isBound ? (
      <Button variant="ghost" onClick={() => doUnbind(info.row.original.treasureId)}>
        <Link2Off size={16} />
      </Button>
    ) : (
      <Button variant={isSelected ? 'primary' : 'ghost'}
        onClick={() => { setPending(info.row.original); setFlashPrice(''); setFlashStock('0'); }}>
        <Link size={16} />
      </Button>
    );
  },
})
```

### 3.4 绑定流程——三步确认

```
Step 1: 点击某商品的 Link 按钮 → 设为 pending
Step 2: 底部面板出现，填写 flashPrice + flashStock
Step 3: 点击 Confirm Bind → 校验价格 → 调用 doBind
```

```typescript
const handleConfirmBind = () => {
  if (!pending) return;
  const price = flashPrice.trim();
  if (!price || isNaN(Number(price))) {
    addToast('error', t('flashSale.invalidPrice'));
    return;
  }
  doBind(sessionId, {
    treasureId: pending.treasureId,
    flashPrice: price,
    flashStock: parseInt(flashStock, 10) || 0,
  });
};
```

底部分配面板（`bg-teal-50/40`）包含：
- 当前选中商品名（`line-clamp-1`）
- 双输入框：活动价 + 抢单库存
- 取消/确认按钮

### 3.5 解绑逻辑

```typescript
const { run: doUnbind, loading: unbindLoading } = useRequest(
  async (treasureId: string) => {
    const data = await flashSaleApi.getSessionProducts(sessionId);
    const record = (data?.list ?? []).find((p) => p.treasureId === treasureId);
    if (record) await flashSaleApi.removeProduct(record.id);
  },
  {
    manual: true,
    onSuccess: () => {
      addToast('success', t('flashSale.unbindSuccess'));
      fetchBound();  // 刷新绑定列表
      onSaved();     // 通知父组件
    },
  },
);
```

解绑需要先通过 `getSessionProducts` 获取绑定记录 ID，再调用 `removeProduct`。

## 4. ActSectionBindProductModal（活动专区绑定）

### 4.1 状态管理

```typescript
const [selectedRows, setSelectedRows] = useState<Product[]>([]);  // 勾选的商品
const [existingIds, setExistingSelectedRows] = useState<string[]>([]); // 已有绑定
const [searchTerm, setSearchTerm] = useState('');
```

### 4.2 初始化与数据同步

```typescript
// 拉取专区详情，获取已有绑定商品 ID
const { run: getDetail } = useRequest(actSectionApi.getDetail, {
  manual: true,
  onSuccess: (data) => {
    if (data?.items) {
      const ids = data.items.map((item) => item.treasureId);
      setExistingSelectedRows(ids as string[]);
    }
  },
});

useEffect(() => {
  getDetail(editingData.id);
  run({ current: 1, pageSize: 5 }, { name: '' });
}, [editingData.id, getDetail, run]);
```

### 4.3 列定义

与 Flash Sale 类似的三列结构，但增加了 BaseTable 的 `selectable={true}` 和 `defaultSelectedRowKeys`：

```typescript
<BaseTable
  selectable={true}
  defaultSelectedRowKeys={existingIds}  // 默认勾选已绑定的行
  disabledRowKeys={existingIds}         // 已绑定的行不可取消勾选
  onSelectionChange={handleSelectionChange}
  ...
/>
```

**行内操作**：已在专区的商品显示 `Link2Off` 解绑按钮，未绑定的显示 `Link` 即时绑定按钮。

### 4.4 解绑——先确认后执行

```typescript
const unbind = useCallback((product: Product) => {
  ModalManager.open({
    title: t('actSections.unbindTitle'),
    content: t('actSections.unbindContent', { name: product.treasureName }),
    confirmText: t('actSections.unbind'),
    cancelText: t('actSections.cancel'),
    onConfirm: () => {
      if (unbindLoading) return;
      unbindProduct(editingData.id, product.treasureId);
    },
  });
}, [editingData.id, unbindLoading, unbindProduct, t]);
```

与 Flash Sale 直接解绑不同，活动专区解绑使用 [`ModalManager`](apps/admin-next/src/views/act-section/ActSectionBindProductModal.tsx:111) 弹出二次确认对话框，防止误操作。

### 4.5 批量确认绑定

```typescript
const confirm = () => {
  const products = Object.values(selectedRows).map((product) => product.treasureId);
  if (products.length === 0) {
    addToast('error', t('actSections.toastSelectProduct'));
    return;
  }
  bindProduct(editingData.id, { treasureIds: products });
};
```

### 4.6 防死循环设计

```typescript
// 关键：useCallback 保持引用稳定
const handleSelectionChange = useCallback((data: Product[]) => {
  setSelectedRows(data);
}, []);
```

[`ActSectionBindProductModal`](apps/admin-next/src/views/act-section/ActSectionBindProductModal.tsx:130) 中的注释详细说明了原因：如果 `handleSelectionChange` 不做 `useCallback` 包裹，每次渲染都会创建新引用，导致 `BaseTable` 认为 onSelectionChange 变化，触发重渲染，形成死循环。

## 5. ProductSelectorModal（活动专区创建/编辑）

### 5.1 Create/Edit 双模式

```typescript
interface Props {
  close: () => void;
  confirm: () => void;
  editingData?: ActSection | null;  // 有值=编辑，无值=创建
  t: TFunc;
}
```

```typescript
const onSubmit = async (values: ActSectionFormInputs) => {
  if (editingData) {
    updateActSection(editingData.id, values);
    return;
  }
  creatActSection(values);
};
```

### 5.2 表单字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `title` | `FormTextField` | 活动标题 |
| `key` | `FormTextField` | 唯一标识符 |
| `imgStyleType` | `FormSelectField` | 展示样式类型（0-4） |
| `limit` | `FormTextField number` | 商品数量限制 |
| `startAt` | `FormDateField` | 开始时间 |
| `endAt` | `FormDateField` | 结束时间 |
| `status` | `FormCheckboxField` | 启用/禁用 |

`imgStyleType` 使用 `numeric={true}` 以数字类型提交，提供 5 种样式选项。

### 5.3 编辑回填

```typescript
useEffect(() => {
  if (editingData) {
    form.reset({
      title: editingData.title,
      key: editingData.key,
      imgStyleType: editingData.imgStyleType,
      limit: editingData.limit,
      startAt: editingData.startAt ? new Date(editingData.startAt) : undefined,
      endAt: editingData.endAt ? new Date(editingData.endAt) : undefined,
      status: editingData.status,
    }, {
      keepDirtyValues: false,
      keepTouched: false,
      keepErrors: false,
    });
  }
}, [editingData, form]);
```

使用 `form.reset()` 而非直接设置 `defaultValues`，确保在异步加载数据后正确回填，同时清除可能存在的脏标记和错误状态。

## 6. 通用模式分析

### 6.1 useAntdTable + BaseTable 组合

两个 BindProductModal 都使用 `useAntdTable` 处理商品分页数据，配合 `BaseTable` 渲染：

```
useAntdTable(getTableData)
  → tableProps.dataSource (数据源)
  → tableProps.pagination (分页)
  → BaseTable 渲染
```

与 [`Coupon.tsx`](apps/admin-next/src/views/Marketing/Coupon.tsx:109) 中的用法一致，这是 admin-next 中弹窗内商品选择的标准模式。

### 6.2 搜索模式

```typescript
<Input
  value={searchTerm}
  onChange={(e) => setSearchTerm(e.target.value)}
  onKeyDown={(e) => e.key === 'Enter' && run({ current: 1, pageSize: 5 }, { name: searchTerm })}
/>
<Button onClick={() => run({ current: 1, pageSize: 5 }, { name: searchTerm })}>
  <Search size={16} />
</Button>
```

- 支持回车键触发搜索
- 点击搜索按钮触发搜索
- 搜索参数 `name` 传入 `getTableData` 的 `formData`

### 6.3 SmartImage 商品缩略图

两个组件都使用 `SmartImage` 展示商品封面：

```typescript
<SmartImage
  width={40} height={40}
  layout="constrained"
  src={row.original.treasureCoverImg}
  className="min-w-[40px] h-10 rounded object-cover bg-gray-100"
  alt=""
  loading="lazy"
/>
```

`min-w-[40px]` 防止图片未加载时列宽塌缩。

## 7. 设计要点总结

1. **单品绑定 vs 批量绑定**：Flash Sale 使用 `pending` state 先选后填参数，Act Section 使用 checkbox 多选后一键确认，反映不同的业务需求
2. **解绑安全策略不同**：Flash Sale 直接行内解绑（操作快），Act Section 先弹二次确认（防止批量误操作）
3. **BaseTable 防死循环**：`handleSelectionChange` 必须 `useCallback` 保持引用稳定
4. **已有绑定的视觉反馈**：`defaultSelectedRowKeys` + `disabledRowKeys` 让用户清晰知道哪些商品已在活动中
5. **双向数据同步**：绑定/解绑后都调用 `fetchBound()` 或 `getDetail()` 刷新数据，保持 UI 与后端一致
6. **商品搜索的Enter+按钮双触发**：提升搜索操作的便利性

## 8. 完整数据流

```
Flash Sale 绑定:
  ModalManager.open({ FlashSaleBindProductModal, props: { sessionId } })
  → useEffect: fetchBound() + useAntdTable 加载商品列表
  → 用户搜索商品 → 点击 Link →
    pending = 选中商品, 底部面板浮现
  → 填写 flashPrice + flashStock → Confirm Bind →
    doBind(sessionId, { treasureId, flashPrice, flashStock })
  → onSuccess: fetchBound() + onSaved()

Act Section 绑定:
  ModalManager.open({ ActSectionBindProductModal, props: { editingData } })
  → useEffect: getDetail(editingData.id) + useAntdTable
  → 用户勾选商品 → Confirm Add →
    bindProduct(editingData.id, { treasureIds })
  → onSuccess: onConfirm()
```

## 9. 总结

[`FlashSaleBindProductModal`](apps/admin-next/src/views/flash-sale/FlashSaleBindProductModal.tsx:27) 和 [`ActSectionBindProductModal`](apps/admin-next/src/views/act-section/ActSectionBindProductModal.tsx:23) 展示了同一个"商品选择绑定"需求在不同业务场景下的差异化实现。两者共享 `useAntdTable` + `BaseTable` + `SmartImage` 的底层基础设施，但在选择模式（单选 vs 多选）、参数配置（价格/库存 vs 无）、解绑流程（直接 vs 确认框）上各有侧重。[`ProductSelectorModal`](apps/admin-next/src/views/act-section/ProductSelectorModal.tsx:31) 则作为活动专区的创建/编辑入口，与 BindProductModal 配合完成完整的活动管理闭环。

### 相关文章

- [SmartTable——泛型智能表格](smart-table-generic-data-grid.md)
- [优惠券营销系统——CouponModal + CouponList](coupon-marketing-system.md)
- [Banner 管理——FormModal + BindProduct](banner-management-form-modal.md)
- [商品 CRUD——CreateProductFormModal + EditProductFormModal](product-crud-create-edit-form.md)
- [UI 组件库——Button、BaseTable、SmartImage 等](ui-components-library.md)
