---
title: 'SmartTable — 泛型智能表格：列驱动搜索 + 表格 + 分页一体化'
slug: smart-table-generic-data-grid
tags: Next.js, Admin, React, TypeScript, Components, Table, Data Grid
description: The admin blog's SmartTable is a ProTable-style generic component that eliminates boilerplate for every list page. Define columns once, get search form, data table, pagination, toolbar, and export — all automatically wired together.
---

# SmartTable — 泛型智能表格：列驱动搜索 + 表格 + 分页一体化

> **Article A1** — The admin blog's SmartTable is a ProTable-style generic component that eliminates boilerplate for every list page. Define columns once, get search form, data table, pagination, toolbar, and export — all automatically wired together.

- **GitHub**: [`SmartTable.tsx`](apps/admin-blog/src/components/scaffold/SmartTable/SmartTable.tsx) (521L), [`BaseTable.tsx`](apps/admin-blog/src/components/scaffold/BaseTable.tsx) (503L), [`SchemaSearchForm.tsx`](apps/admin-blog/src/components/scaffold/SchemaSearchForm.tsx) (150L), [`Pagination.tsx`](apps/admin-blog/src/components/scaffold/Pagination.tsx) (103L)
- **Types**: [`types.ts`](apps/admin-blog/src/components/scaffold/SmartTable/types.ts)
- **Usage**: [`articles/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/articles/page.tsx), [`categories/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/categories/page.tsx)
- **Series**: Admin Architecture Deep Dive

---

## 1. The Problem: Repetitive List Page Boilerplate

In an admin panel, every list page follows the same pattern:

```
┌─ Search / Filter Bar ──────────────────────────────┐
│  [Search...]  [Status ▼]  [Category ▼]  [Search]   │
├─ Toolbar ───────────────────────────────────────────┤
│  Article List                   [+ New] [Export] [↻]│
├─ Table ─────────────────────────────────────────────┤
│  ☐ │ Title            │ Status │ Category │ Actions │
│  ☐ │ SSR Architecture │ Draft  │ Tech     │ [✏︎][🗑] │
│  ☐ │ Zustand Deep Dive│ Pub.   │ Arch     │ [✏︎][🗑] │
├─ Pagination ────────────────────────────────────────┤
│  Total: 42 items                    « 1 2 3 ... »  │
└─────────────────────────────────────────────────────┘
```

Without a generic component, each page requires:
- A `request` function (fetch + transform data)
- Column definitions with custom renderers
- Search form state management (React Hook Form or raw)
- Pagination state (page, pageSize, total)
- Loading state + empty state + error handling
- URL search params sync
- Export, refresh, CRUD action callbacks

**SmartTable** abstracts **all of this** behind a single component with ~15 props.

---

## 2. Architecture Overview

```
                    ┌──────────────────────────────┐
                    │        SmartTable             │
                    │  (Orchestrator — 521 lines)   │
                    └──────────┬───────────────────┘
                               │
              ┌────────────────┼──────────────────┐
              ▼                ▼                    ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
    │ SchemaSearch  │  │   Toolbar    │  │    BaseTable      │
    │    Form       │  │  (Header +   │  │ (TanStack Table)  │
    │ (React Hook   │  │   Buttons)   │  │                   │
    │   Form)       │  │              │  │ ┌──────────────┐  │
    │               │  │ • Title      │  │ │ TableHeader  │  │
    │ • Input       │  │ • New Btn    │  │ │ TableBody    │  │
    │ • Select      │  │ • Export     │  │ │ (Sortable    │  │
    │ • Date        │  │ • Refresh    │  │ │  Rows)       │  │
    └──────────────┘  └──────────────┘  │ │ Pagination   │  │
                                        │ └──────────────┘  │
                                        └──────────────────┘
```

### Component hierarchy

| Component | Role | Dependencies |
|-----------|------|-------------|
| [`SmartTable`](apps/admin-blog/src/components/scaffold/SmartTable/SmartTable.tsx) | Top-level orchestrator | `BaseTable`, `SchemaSearchForm`, `@tanstack/react-query` |
| [`BaseTable`](apps/admin-blog/src/components/scaffold/BaseTable.tsx) | Table rendering engine | `@tanstack/react-table`, `@dnd-kit`, `@repo/ui` |
| [`SchemaSearchForm`](apps/admin-blog/src/components/scaffold/SchemaSearchForm.tsx) | Form rendering engine | `react-hook-form`, `@repo/ui` |
| [`Pagination`](apps/admin-blog/src/components/scaffold/Pagination.tsx) | Pagination UI | i18n-aware |

---

## 3. The Column-Driven Design

The core philosophy: **define columns once, everything else is derived**.

### ProColumns type system

```typescript
// types.ts — ProColumns definition
export type ValueType = 'text' | 'money' | 'date' | 'dateTime' | 'dateRange' | 'select' | 'option' | 'index';

export type ProColumns<T = any> = {
  title: string;
  dataIndex?: keyof T | string;
  width?: number;
  valueType?: ValueType;
  copyable?: boolean;
  valueEnum?: valueEnumType;
  search?: boolean | {
    order?: number;
    title?: string;
    valueType?: ValueType;
    transform?: (value: any) => any;
    formItemProps?: Record<string, any>;
  };
  hideInTable?: boolean;
  hideInSearch?: boolean;
  render?: (dom: ReactNode, entity: T, index: number, action?: ActionType) => ReactNode;
};
```

### ValueEnum: The enum mapping system

The [`valueEnumType`](apps/admin-blog/src/components/scaffold/SmartTable/types.ts:16) supports two forms:

```typescript
type ValueEnumItem = ReactNode | {
  text: string;
  status?: string;   // Semantics (used as Badge color)
  color?: string;    // Explicit Badge color
};
```

Both string and object forms are supported:

```typescript
// Simple ReactNode form
valueEnum: {
  PUBLISHED: <Badge color="green">Published</Badge>,
  DRAFT: <Badge color="gray">Draft</Badge>,
}

// Config object form (auto-renders as Badge)
valueEnum: {
  PUBLISHED: { text: 'Published', status: 'Success' },
  DRAFT: { text: 'Draft', status: 'Default' },
  ARCHIVED: { text: 'Archived', status: 'Processing' },
}
```

### From columns → search schema

The [`transformColumnsToSchema`](apps/admin-blog/src/components/scaffold/SmartTable/SmartTable.tsx:126) function auto-generates search form fields from column definitions:

```typescript
const transformColumnsToSchema = (columns: ProColumns[]): FormSchema[] => {
  return columns
    .filter((col) => col.search !== false && !col.hideInSearch && col.valueType !== 'option')
    .map((col) => {
      let type = 'input';
      let options: any[] | undefined = undefined;

      if (valueType === 'select' && col.valueEnum) {
        type = 'select';
        options = Object.entries(col.valueEnum).map(([k, v]) => ({
          label: typeof v === 'object' && 'text' in v ? v.text : v,
          value: k,
        }));
        options.unshift({ label: 'All', value: 'ALL' });
      } else if (valueType === 'date' || valueType === 'dateTime' || valueType === 'dateRange') {
        type = 'date';
      }
      // ...
    });
};
```

Rules:
- Columns with `search: false` or `hideInSearch: true` are excluded
- `valueType: 'select'` with `valueEnum` → select dropdown with "All" default
- `valueType: 'date' | 'dateTime' | 'dateRange'` → date picker
- All others → text input
- An explicit [`searchSchema`](apps/admin-blog/src/components/scaffold/SmartTable/SmartTable.tsx:366) prop overrides auto-generation

---

## 4. SmartTable Core Logic

### Props

```typescript
interface SmartTableProps<T> {
  rowKey: keyof T;
  headerTitle?: React.ReactNode;
  columns: ProColumns<T>[];
  searchSchema?: FormSchema[];        // Override auto-generated search form
  request?: RequestData<T>;           // Async data fetcher
  dataSource?: T[];                   // Static data (no request)
  params?: Record<string, any>;       // Extra params merged into request
  toolBarRender?: () => React.ReactNode[];
  onExport?: (params: any) => void;
  defaultPageSize?: number;
  initialFormParams?: Record<string, any>;  // From URL searchParams
  onParamsChange?: (params: Record<string, any>) => void;  // URL sync
  enableHydration?: boolean;           // React Query Hydration
  hydrationQueryKey?: readonly unknown[];
}
```

### State machine

```
┌──────────────────────────────────────────────────────────────┐
│                         SmartTable State                      │
│                                                               │
│  ┌──────────┐    search/reset    ┌───────────┐               │
│  │ formParams│ ◄──────────────────│onParamsChange│            │
│  │          │ ──────────────────►│ (URL sync)  │              │
│  └────┬─────┘                    └───────────┘               │
│       │                                                       │
│       ▼                                                       │
│  ┌──────────┐    fetchData()     ┌───────────┐               │
│  │pagination │ ──────────────────►│   data     │              │
│  │ page      │                   │   total    │              │
│  │ pageSize  │                   └───────────┘               │
│  └──────────┘                                               │
│       ▲                                                       │
│       │                                                       │
│  ┌────┴─────┐    reload()        ┌───────────┐               │
│  │ActionRef │ ◄──────────────────│  Parent    │              │
│  │ reload() │                    │ Component  │              │
│  │ reset()  │                    └───────────┘               │
│  └──────────┘                                               │
└──────────────────────────────────────────────────────────────┘
```

### Data flow

1. **Mount** → `useEffect` triggers `fetchData()` with `pagination` + `formParams`
2. **Search** → `handleSearch(values)` resets page to 1, updates `formParams`, calls `onParamsChange`
3. **Page change** → `onPageChange(p, ps)` updates `pagination`, triggers re-fetch
4. **Refresh** → `handleRefresh()` resets all state, forces fetch (even if state didn't change)
5. **`actionRef.reload(resetPage?)`** → imperatively re-fetch from parent (e.g., after CRUD)
6. **`actionRef.reset()`** → resets `formParams` and page to 1

### Request function pattern

```typescript
const requestArticles = useCallback(async (params: {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  category?: string;
}) => {
  const response = await blogApi.getArticles({
    search: params.search,
    status: params.status?.toUpperCase(),
    categoryId: params.category,
    page: params.page,
    pageSize: params.pageSize,
  });

  return {
    data: response.list.map(transformArticle),
    total: response.total || 0,
    success: true,
  };
}, []);
```

Key details:
- SmartTable passes `{ page, pageSize, ...formParams }` to the request function
- The request function returns `{ data: T[], total: number, success?: boolean }`
- 4xx errors are silently handled by the HTTP interceptor (no console noise)
- Non-4xx errors are logged via `console.error`

### URL search params sync

SmartTable supports two-way URL query parameter sync:

```typescript
// Parent page
const searchParams = useSearchParams();
const initialParams = useMemo(() => ({
  search: searchParams.get('search') || '',
  status: searchParams.get('status') || '',
}), [searchParams]);

const handleParamsChange = useCallback((params: Record<string, any>) => {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v) sp.set(k, String(v));
  });
  router.replace(`?${sp.toString()}`);
}, [router]);

<SmartTable
  initialFormParams={initialParams}
  onParamsChange={handleParamsChange}
  // ...
/>
```

This means:
- Bookmarking a page preserves search state
- The browser back/forward navigation restores search filters
- The search form pre-fills from URL on mount

---

## 5. React Query Hydration Support

SmartTable optionally integrates with React Query's SSR hydration pattern:

```typescript
const hydrationQuery = useQuery<{ data: T[]; total: number }>({
  queryKey: hydrationQueryKey,     // Default: ['smart-table-hydration']
  queryFn: async () => ({ data: [], total: 0 }),
  enabled: enableHydration,
  staleTime: 30_000,               // 30s reuse window
});
```

When hydration data exists:
- The first render skips the `fetchData()` call
- Hydrated data is displayed immediately (zero network round-trip)
- After 30 seconds, stale data is replaced by live fetch
- Subsequent pagination/search always triggers normal requests

This is used in Server Component pages that pre-fetch data:

```typescript
// Server Component
const { data, total } = await prefetchArticles(locale);

// Page component wraps with HydrationBoundary
<HydrationBoundary state={dehydrate(queryClient)}>
  <ArticlesPage />
</HydrationBoundary>
```

The `hydrationConsumedRef` pattern ensures the hydrated data is used **exactly once**:

```typescript
useEffect(() => {
  if (hasHydratedRows && !hydrationConsumedRef.current) {
    hydrationConsumedRef.current = true;
    return;  // Skip first fetch
  }
  if (request) fetchData().catch();
}, [request, dataSource, fetchData, hasHydratedRows]);
```

---

## 6. BaseTable: The Table Rendering Engine

[`BaseTable`](apps/admin-blog/src/components/scaffold/BaseTable.tsx) wraps [`@tanstack/react-table`](https://tanstack.com/table/latest) with additional features:

### 6.1 Sorting

Columns are sortable by default (click header to toggle asc/desc). The `ArrowUpDown` icon indicates sortability:

```typescript
const [sorting, setSorting] = useState<SortingState>([]);
// ...
const table = useReactTable({
  state: { sorting, rowSelection },
  onSortingChange: setSorting,
  getSortedRowModel: getSortedRowModel(),
  // ...
});
```

### 6.2 Drag-and-Drop with @dnd-kit

When `enableDrag` is true, rows become sortable via drag-and-drop:

```typescript
<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
  <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
    {rows}
  </SortableContext>
</DndContext>
```

The [`SortableRowWrapper`](apps/admin-blog/src/components/scaffold/BaseTable.tsx:53) transforms a regular `<tr>` into a sortable element. Drag handles are detected via `data-drag-handle` attribute:

```typescript
// SmartTable can define a drag handle column
{
  id: 'dragHandle',
  cell: () => <GripHorizontal className="cursor-grab" data-drag-handle />,
}
```

### 6.3 Row Selection

When `selectable` is true, a Checkbox column is prepended:

```typescript
if (selectable) {
  cols.unshift({
    id: 'select',
    header: ({ table }) => <Checkbox checked={...} onCheckedChange={...} />,
    cell: ({ row }) => <Checkbox checked={row.getIsSelected()} disabled={...} />,
  });
}
```

- `disabledRowKeys` prevents selection on specific rows
- `defaultSelectedRowKeys` pre-selects rows on mount
- `onSelectionChange` callback provides selected row data

### 6.4 Expandable Rows

When `expandable` is true, an expander column is prepended with ChevronRight/ChevronDown toggles:

```typescript
if (expandable) {
  cols.unshift({
    id: 'expander',
    cell: ({ row }) => row.getCanExpand() ? (
      <button onClick={() => row.toggleExpanded()}>
        {row.getIsExpanded() ? <ChevronDown /> : <ChevronRight />}
      </button>
    ) : null,
  });
}
```

### 6.5 Memoized Row Rendering

Rows are memoized to prevent unnecessary re-renders when columns change (e.g., language switch):

```typescript
const MemoizedTableRow = React.memo(TableRowImpl, (prev, next) => {
  return (
    prev.columnsRevision === next.columnsRevision &&
    prev.row.original === next.row.original &&
    prev.isSelected === next.isSelected &&
    prev.isExpanded === next.isExpanded &&
    prev.enableDrag === next.enableDrag
  );
});
```

The `columnsRevision` prop acts as a version counter — when column definitions change (new language, new columns), all rows re-render.

### 6.6 i18n with optional t prop

BaseTable and Pagination use a clever pattern to support i18n in two contexts:

```typescript
export const BaseTable = <TData,>(props: BaseTableProps<TData>) => {
  if (props.t) {
    return <BaseTableInner {...props} t={props.t} />;
  }
  return <BaseTableWithT {...props} />;
};
```

- **Normal React tree**: `BaseTableWithT` calls `useTranslation()` internally
- **Inside ModalManager** (no `NextIntlClientProvider` context): parent passes `t` prop explicitly

---

## 7. RenderSmartCell: Intelligent Cell Rendering

The [`renderSmartCell`](apps/admin-blog/src/components/scaffold/SmartTable/SmartTable.tsx:73) function automatically formats cell values based on `valueType`:

| ValueType | Render | Example |
|-----------|--------|---------|
| `text` | Raw string | `"SSR Architecture"` |
| `money` | `NumHelper.formatMoney()` with `font-mono` | `"₱12,345.00"` |
| `date` | `TimeHelper.formatDate()` in muted gray | `"2026-01-15"` |
| `dateTime` | `TimeHelper.formatDateTime()` in muted gray | `"2026-01-15 14:30"` |
| `select` | `valueEnum` lookup → Badge or ReactNode | `<Badge>Published</Badge>` |
| Default | Raw string | `"..."` |

Empty/undefined values render as a dash (`-`).

---

## 8. SchemaSearchForm: Auto-Generated Form

[`SchemaSearchForm`](apps/admin-blog/src/components/scaffold/SchemaSearchForm.tsx) uses `react-hook-form` to render a search form from a schema array:

```typescript
// Supported field types
interface SearchFieldSchema<T> {
  key: keyof T;
  label: string;
  type: 'input' | 'select' | 'date';
  options?: { label: string; value: string }[];  // For select type
  placeholder?: string;
  defaultValue?: string;
  className?: string;  // Grid column span
  showTime?: boolean;  // For date type
  mode?: 'single' | 'range';  // For date type
}
```

The form renders as a responsive grid:
- `grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4`
- Search and Reset buttons are always present
- Empty/undefined/null values are filtered out before submission via `cleanValues()`

### Reset behavior

A subtle but important detail: **reset goes to schema defaults, not initial URL params**:

```typescript
// Reset uses schema defaults (not initialValues from URL)
const resetValues = useMemo(() => {
  const defaults: any = {};
  schema.forEach((field) => {
    defaults[field.key] = field.defaultValue ?? '';
  });
  return defaults;
}, [schema]);
```

This ensures that reset always produces a clean slate, even if URL params had stale filters.

---

## 9. Usage Examples

### 9.1 Simple: Categories Page

[`categories/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/categories/page.tsx) — minimal SmartTable with a single text search:

```typescript
const categoryColumns: ProColumns[] = [
  { dataIndex: 'name', title: t('name'), render: (dom, category) => (
    <div className="flex items-center">
      <FolderTree className="mr-2 h-4 w-4 text-muted-foreground" />
      <div className="font-medium">{renderLocalizedText(category.name)}</div>
    </div>
  )},
  { dataIndex: 'slug', title: t('slug'), render: (dom, category) => (
    <code className="text-sm bg-muted px-2 py-1 rounded">/{category.slug}</code>
  )},
  { dataIndex: 'articleCount', title: t('articles'), render: (dom, category) => (
    <span className="px-2 py-1 text-xs rounded-full bg-primary/10 text-primary">
      {category.articleCount || 0} {t('articles')}
    </span>
  )},
  { dataIndex: 'actions', title: t('actions'), valueType: 'option', render: (dom, category) => (
    <div className="flex justify-end gap-2">
      <Button variant="outline" size="sm" onClick={() => handleEditCategory(category)}>
        <Edit className="h-4 w-4" />
      </Button>
      <Button variant="outline" size="sm" onClick={() => handleDeleteCategory(category)}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  )},
];

const searchSchema: FormSchema[] = [
  { type: 'input', key: 'search', label: t('search'), placeholder: t('searchPlaceholder') },
];

<SmartTable
  ref={actionRef}
  rowKey="id"
  columns={categoryColumns}
  request={requestCategories}
  searchSchema={searchSchema}
  headerTitle={<><FolderTree className="text-primary-500" size={20} /><span>{t('categoryList')}</span></>}
/>
```

This produces a page with a single search bar, a sortable table with 4 columns + actions, and pagination — all from ~40 lines of SmartTable configuration (vs. ~200 lines of manual wiring).

### 9.2 Complex: Articles Page

[`articles/page.tsx`](apps/admin-blog/src/app/(dashboard)/blog/articles/page.tsx) — full-featured with multi-filter search, rich renderers, CRUD mutations, and action ref:

```
Search Form: [Text search] [Status: Published/Draft/Archived ▼] [Category ▼]
Toolbar: [+ New Article] [Export] [↻]
Table:
  ☐ │ Article (title + slug + author + read time) │ Status │ Category │ Tags │ Metrics (views, comments) │ Published Date │ Actions (Preview/Edit/Publish/Delete) │
```

The `requestArticles` function includes data transformation:

```typescript
const requestArticles = useCallback(async (params: SearchParams) => {
  const response = await blogApi.getArticles({
    search: params.search,
    status: params.status?.toUpperCase(),
    categoryId: params.category,
    page: params.current,
    pageSize: params.pageSize,
  });

  return {
    data: response.list.map((article) => ({
      ...article,
      views: article.viewCount || 0,           // API field mapping
      comments: article.commentCount || 0,
      tags: article.tags.map(extractTagName),   // Transform tag objects → strings
    })),
    total: response.total || 0,
    success: true,
  };
}, []);
```

After CRUD operations, `actionRef.current?.reload()` refreshes the table:

```typescript
const deleteArticleMutation = useMutation({
  mutationFn: (id: string) => blogApi.deleteArticle(id),
  onSuccess: () => {
    addToast('success', t('articleDeleted'));
    actionRef.current?.reload();
  },
});
```

---

## 10. The `forwardRef` + Generic Type Pattern

SmartTable uses a TypeScript pattern to forward refs with generic types:

```typescript
export const SmartTable = forwardRef(SmartTableInner) as <
  T extends Record<string, any>,
>(
  props: SmartTableProps<T> & { ref?: React.Ref<ActionType> },
) => React.ReactElement;
```

The `forwardRef` wrapper provides:
- **Generic type inference**: `<SmartTable<Article> ref={...} columns={...} />` type-checks all column renderers
- **Action ref**: Parent components can imperatively call `reload()` and `reset()`
- **No `any` leakage**: The cast is isolated at the export boundary

---

## 11. Performance Considerations

| Aspect | Strategy |
|--------|----------|
| **Row memoization** | `React.memo` with `columnsRevision` versioning |
| **Column memoization** | `useMemo` for `tableColumns` and `finalSearchSchema` |
| **Pagination reference** | `useMemo` for `paginationProps` — stable reference prevents unnecessary re-fetches |
| **External params** | `useMemo` for `externalParams` — prevents infinite loops |
| **DnD sensors** | Created once via `useSensor` |
| **Request caching** | Parent can add `useCallback` with stable deps (as shown in articles page) |
| **Hydration** | `hydrationConsumedRef` — single-use flag prevents double-fetch |

---

## 12. Comparison: SmartTable vs. Ant Design ProTable

| Feature | SmartTable | Ant Design ProTable |
|---------|------------|-------------------|
| Column-driven search | ✅ Auto-generated from columns | ✅ |
| ValueEnum | ✅ ReactNode or config object | ✅ Enum mapping |
| Action ref | ✅ `reload()`, `reset()` | ✅ `reload()`, `reset()` |
| URL params sync | ✅ `initialFormParams` + `onParamsChange` | ❌ Not built-in |
| Drag-and-drop | ✅ `@dnd-kit` integration | ❌ |
| Expandable rows | ✅ Sub-component rendering | ✅ |
| Row selection | ✅ Checkbox + keyboard | ✅ |
| Sorting | ✅ Multi-column | ✅ |
| Export | ✅ `onExport` callback | ✅ |
| React Query Hydration | ✅ Built-in via `enableHydration` | ❌ |
| i18n | ✅ Dual-mode (context + prop) | ✅ |
| Bundle size | ~15KB (SmartTable + BaseTable + deps) | ~200KB+ (antd) |

SmartTable is purpose-built for the JoyMini admin panel — it covers the same use cases as ProTable but in a fraction of the bundle size, with deeper integration into the existing stack (React Query hydration, DnD, URL sync).

---

## 13. Evolution History

### Stage 1: Individual Page Tables

Each list page had its own table with manual state management, search form, and API calls. The categories page and articles page had ~60% duplicated code.

### Stage 2: BaseTable Extraction

Extracted the core table rendering into `BaseTable.tsx` using `@tanstack/react-table`. This eliminated duplication for sorting, selection, and pagination UI.

### Stage 3: SmartTable Orchestrator

Added `SmartTable.tsx` that composes `BaseTable` + `SchemaSearchForm` + toolbar. Introduced the column-driven search schema transformation.

### Stage 4: URL Sync + Action Ref (current)

Added `initialFormParams`/`onParamsChange` for URL search params sync, `actionRef` for imperative control, and `enableHydration` for React Query SSR hydration.

### Planned: Stage 5

- `column.exportable` + auto CSV export
- `column.summary` for footer aggregation
- Inline editing mode

---

## 14. Conclusion

SmartTable demonstrates a powerful pattern for admin panel development:

1. **Column-driven architecture**: Define once, derive search form + table + export
2. **Composable layers**: `SmartTable` → `BaseTable` → `@tanstack/react-table`, each independently testable
3. **Framework-integrated**: React Query hydration, URL sync, i18n dual-mode
4. **Extensible**: `toolBarRender`, `render`, `onExport`, `searchSchema` override — every seam is open
5. **Type-safe**: Generic `ProColumns<T>` with full type inference

The result: a new list page in the admin panel requires ~40 lines of configuration instead of ~200 lines of boilerplate, with consistent search, pagination, sorting, and UX across the entire application.
