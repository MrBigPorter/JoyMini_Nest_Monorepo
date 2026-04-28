'use client';

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useImperativeHandle,
  forwardRef,
} from 'react';
import get from 'lodash/get';
import { RefreshCw, Download } from 'lucide-react';
import { Button } from '@repo/ui';
import { useQuery } from '@tanstack/react-query';

import { BaseTable } from '@/components/scaffold/BaseTable';
import { SchemaSearchForm } from '@/components/scaffold/SchemaSearchForm';
import { Badge, BadgeColor } from '@/components/UIComponents';
import { NumHelper, TimeHelper } from '@lucky/shared';

import type {
  ProColumns,
  RequestData,
  ActionType,
  ValueType,
  valueEnumType,
} from './types';
import { FormSchema } from '@/type/search';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface SmartTableProps<T extends Record<string, any>> {
  rowKey: keyof T;
  headerTitle?: React.ReactNode;
  columns: ProColumns<T>[];
  searchSchema?: FormSchema[];
  request?: RequestData<T>;
  dataSource?: T[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: Record<string, any>;
  toolBarRender?: () => React.ReactNode[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onExport?: (params: any) => void;
  defaultPageSize?: number;
  /**
   * 初始搜索参数（来自 URL searchParams）。
   * 表单渲染时预填充，SmartTable 首次请求也会带上这些参数。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialFormParams?: Record<string, any>;
  /**
   * 搜索条件变化时的回调（search / reset 都会触发）。
   * 用于 URL searchParams 同步：父组件拿到新 params 后调用 router.replace()。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onParamsChange?: (params: Record<string, any>) => void;
  /**
   * 是否启用 React Query Hydration 消费（用于 Server 预取）
   * 若启用，SmartTable 会优先尝试从 useQuery 消费 hydrated 数据而非直接调用 request
   * 默认 false，其他页面无感知
   */
  enableHydration?: boolean;
  /**
   * Hydration query key（需与 Server 预取时保持一致）
   * 默认使用 ['smart-table-hydration']，保持向后兼容
   */
  hydrationQueryKey?: readonly unknown[];
}

// ------------------------------------
// 1. 修复：渲染单元格内容
// ------------------------------------
const renderSmartCell = (
  text: string | number | null | undefined,
  type?: ValueType,
  valueEnum?: valueEnumType,
) => {
  // console.log('Rendering cell:', { text, type });
  if (text === null || text === undefined || text === '') return '-';

  switch (type) {
    case 'money':
      return <span className="font-mono">{NumHelper.formatMoney(text)}</span>;
    case 'date':
      return (
        <span className="text-gray-500 dark:text-gray-400 text-xs">
          {TimeHelper.formatDate(text)}
        </span>
      );
    case 'dateTime':
      return (
        <span className="text-gray-500 dark:text-gray-400 text-xs">
          {TimeHelper.formatDateTime(text)}
        </span>
      );
    case 'select':
      if (valueEnum) {
        // 强制转换为合法的 key 类型
        const item = valueEnum[text as string | number];
        if (item) {
          // 🛠️ 修复点：判断 item 是对象配置还是直接的 ReactNode
          if (
            typeof item === 'object' &&
            'text' in item &&
            !React.isValidElement(item)
          ) {
            // 是配置对象 { text: '...', status: '...' }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { text: label, status, color } = item as any;
            const badgeColor = color || status || 'default';
            return <Badge color={badgeColor as BadgeColor}>{label}</Badge>;
          }
          // 是 ReactNode (例如 JSX 或 字符串)
          return item as React.ReactNode;
        }
      }
      return text;
    default:
      return text;
  }
};

// ------------------------------------
// 2. 修复：Columns -> Search Schema
// ------------------------------------
const transformColumnsToSchema = (columns: ProColumns[]): FormSchema[] => {
  // console.log('Transforming columns to search schema...', columns);
  return columns
    .filter(
      (col) =>
        col.search !== false && !col.hideInSearch && col.valueType !== 'option',
    )
    .map((col) => {
      let type = 'input';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let options: any[] | undefined = undefined;

      const searchConfig = typeof col.search === 'object' ? col.search : {};
      const valueType = searchConfig.valueType || col.valueType;

      if (valueType === 'select' && col.valueEnum) {
        type = 'select';
        options = Object.entries(col.valueEnum).map(([k, v]) => {
          // 🛠️ 修复点：兼容 ReactNode 类型的值
          let label = v;
          if (typeof v === 'object' && v !== null && 'text' in v) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            label = (v as any).text;
          }
          return {
            label: label,
            value: k,
          };
        });
        options.unshift({ label: 'All', value: 'ALL' });
      } else if (valueType === 'date' || valueType === 'dateTime') {
        type = 'date';
      } else if (valueType === 'dateRange') {
        type = 'date';
      }

      return {
        key: (col.dataIndex as string) || '',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        label: (searchConfig as any).title || col.title,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: type as any,
        options,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        placeholder: (searchConfig as any).formItemProps?.placeholder
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (searchConfig as any).formItemProps?.placeholder
          : `Search ${col.title}`,
        // 透传给 FormItem 的属性
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(searchConfig as any).formItemProps,
        // dateRange 强制 range
        ...(valueType === 'dateRange' ? { mode: 'range' } : {}),
      };
    });
};

// ------------------------------------
// 内部组件 (逻辑保持不变)
// ------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SmartTableInner = <T extends Record<string, any>>(
  props: SmartTableProps<T>,
  ref: React.Ref<ActionType>,
) => {
  const {
    columns,
    searchSchema: explicitSearchSchema,
    request,
    dataSource,
    rowKey,
    headerTitle,
    toolBarRender,
    onExport,
    defaultPageSize = 10,
    params,
    initialFormParams = {},
    onParamsChange,
    enableHydration = false,
    hydrationQueryKey = ['smart-table-hydration'],
  } = props;

  // 引用锁定，防止死循环
  const externalParams = useMemo(() => params || {}, [params]);

  const [data, setData] = useState<T[]>(dataSource || []);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);

  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: defaultPageSize,
  });

  const [formParams, setFormParams] =
    useState<Record<string, unknown>>(initialFormParams);
  const hydrationConsumedRef = useRef(false);

  // ── Hydration 支持：若启用，优先消费 hydrated 数据 ──
  const hydrationQuery = useQuery<{ data: T[]; total: number }>({
    // 这个 queryKey 需要和 Server 预取时一致
    queryKey: hydrationQueryKey,
    // 占位符，实际数据由 HydrationBoundary 注入
    queryFn: async () => ({ data: [], total: 0 }),
    enabled: enableHydration,
    // 和 Orders 保持一致：30s 内复用 hydrated 数据，不触发空占位 queryFn
    staleTime: 30_000,
  });

  const hasHydratedRows =
    enableHydration && (hydrationQuery.data?.data?.length ?? 0) > 0;

  // 首次加载时，如启用 hydration 且有数据，直接使用
  useEffect(() => {
    if (hasHydratedRows && hydrationQuery.data) {
      setData(hydrationQuery.data.data);
      setTotal(hydrationQuery.data.total);
      setLoading(false);
    }
  }, [hasHydratedRows, hydrationQuery.data]);

  const onPageChange = useCallback((p: number, ps: number) => {
    setPagination((prev) => {
      if (prev.page === p && prev.pageSize === ps) return prev;
      return { page: p, pageSize: ps };
    });
  }, []);

  const paginationProps = useMemo(() => {
    if (!request) return undefined;
    return {
      current: pagination.page,
      pageSize: pagination.pageSize,
      total,
      onChange: onPageChange,
    };
  }, [request, pagination, total, onPageChange]);

  const fetchData = useCallback(
    async (pageParams = pagination, searchParams = formParams) => {
      if (!request) return;
      setLoading(true);

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const transformedParams: Record<string, any> = { ...searchParams };

        if (!explicitSearchSchema) {
          columns.forEach((col) => {
            const searchConfig =
              typeof col.search === 'object' ? col.search : {};
            const key = col.dataIndex as string;
            if (searchConfig.transform && transformedParams[key]) {
              const transformed = searchConfig.transform(
                transformedParams[key],
              );
              delete transformedParams[key];
              Object.assign(transformedParams, transformed);
            }
          });
        }

        Object.keys(transformedParams).forEach((key) => {
          if (transformedParams[key] === 'ALL') delete transformedParams[key];
        });

        // 避免搜索参数里的 page/pageSize 覆盖分页控件当前页
        // （例如 initialFormParams 来自 URL 时会携带 page=1）
        delete transformedParams.page;
        delete transformedParams.pageSize;
        delete transformedParams.current;

        const res = await request({
          ...externalParams,
          ...transformedParams,
          page: pageParams.page,
          pageSize: pageParams.pageSize,
        });

        setData(res.data);
        setTotal(res.total);
      } catch (e) {
        // 4xx 错误（401/403/404 等）已由 HTTP 拦截器统一处理（toast + redirect），
        // 不需要在此重复 console.error，否则会触发 Next.js dev overlay 红框。
        // 只有非 4xx 的意外错误（5xx、网络断连、代码 bug）才值得打印。
        const status = (e as { response?: { status?: number } })?.response
          ?.status;
        const is4xx = status != null && status >= 400 && status < 500;
        if (!is4xx) {
          console.error('[SmartTable] fetch error:', e);
        }
      } finally {
        setLoading(false);
      }
    },
    [
      request,
      columns,
      externalParams,
      pagination,
      formParams,
      explicitSearchSchema,
    ],
  );

  useEffect(() => {
    // Skip fetch only once when hydrated rows exist.
    // After first render, pagination/search must always drive normal requests.
    if (hasHydratedRows && !hydrationConsumedRef.current) {
      hydrationConsumedRef.current = true;
      return;
    }
    // 否则走原有逻辑
    if (request) fetchData().catch();
    else if (dataSource) setData(dataSource);
  }, [request, dataSource, fetchData, hasHydratedRows]);

  useImperativeHandle(
    ref,
    () => ({
      reload: (resetPage = false) => {
        if (resetPage) {
          setPagination((p) => {
            if (p.page === 1) return p;
            return { ...p, page: 1 };
          });
          fetchData({ ...pagination, page: 1 }, formParams).catch();
          return;
        }
        fetchData(pagination, formParams).catch();
      },
      reset: () => {
        setFormParams({});
        setPagination((p) => ({ ...p, page: 1 }));
      },
    }),
    [fetchData, pagination, formParams],
  );

  const finalSearchSchema = useMemo(
    () => explicitSearchSchema || transformColumnsToSchema(columns),
    [columns, explicitSearchSchema],
  );

  const tableColumns = useMemo(() => {
    return columns
      .filter((col) => !col.hideInTable)
      .map((col) => ({
        header: col.title,
        accessorKey: col.dataIndex as string,
        size: col.width,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cell: (info: any) => {
          const rawValue = col.dataIndex
            ? get(info.row.original, col.dataIndex as string)
            : undefined;

          const dom = renderSmartCell(rawValue, col.valueType, col.valueEnum);

          if (col.render) {
            return col.render(
              dom,
              info.row.original,
              info.row.index,
              undefined,
            );
          }
          return dom;
        },
      }));
  }, [columns]);

  const handleSearch = useCallback(
    (values: Record<string, unknown>) => {
      setPagination((p) => {
        if (p.page === 1) return p;
        return { ...p, page: 1 };
      });

      for (const key in values) {
        if (
          values[key] === '' ||
          values[key] === undefined ||
          values[key] === null
        ) {
          delete values[key];
        }
        if (values[key] === 'ALL') {
          delete values[key];
        }
      }

      setFormParams(values);
      onParamsChange?.(values);
    },
    [onParamsChange],
  );

  const handleReset = useCallback(() => {
    setPagination((p) => {
      if (p.page === 1) return p;
      return { ...p, page: 1 };
    });
    setFormParams({});
    onParamsChange?.({});
  }, [onParamsChange]);

  const handleRefresh = useCallback(() => {
    const resetPage = { page: 1, pageSize: pagination.pageSize };
    const isAlreadyReset =
      pagination.page === 1 && Object.keys(formParams).length === 0;

    setPagination((p) => {
      if (p.page === 1) return p;
      return { ...p, page: 1 };
    });
    setFormParams({});
    onParamsChange?.({});

    // If state is already reset, effects won't re-fire; force one fetch.
    if (isAlreadyReset) {
      fetchData(resetPage, {}).catch();
    }
  }, [
    fetchData,
    formParams,
    onParamsChange,
    pagination.page,
    pagination.pageSize,
  ]);

  return (
    <div className="space-y-4">
      {finalSearchSchema.length > 0 && (
        <SchemaSearchForm
          schema={finalSearchSchema}
          initialValues={initialFormParams}
          onSearch={handleSearch}
          onReset={handleReset}
        />
      )}

      {(headerTitle || toolBarRender || onExport || request) && (
        <div className="flex justify-between items-center px-1">
          {headerTitle ? (
            <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {headerTitle}
            </div>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            {toolBarRender?.()}
            {onExport && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onExport({ ...formParams, ...externalParams })}
              >
                <Download size={14} className="mr-1.5" /> Export
              </Button>
            )}
            {request && (
              <Button
                variant="ghost"
                onClick={handleRefresh}
                disabled={loading}
              >
                <RefreshCw
                  size={16}
                  className={loading ? 'animate-spin' : ''}
                />
              </Button>
            )}
          </div>
        </div>
      )}

      <BaseTable
        data={data}
        columns={tableColumns}
        loading={loading}
        rowKey={rowKey as string}
        pagination={paginationProps}
      />
    </div>
  );
};

export const SmartTable = forwardRef(SmartTableInner) as <
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends Record<string, any>,
>(
  props: SmartTableProps<T> & { ref?: React.Ref<ActionType> },
) => React.ReactElement;
