'use client';

import React, { useCallback, useMemo, useRef } from 'react';
import { Button, ModalManager } from '@repo/ui';
import {
  SmartTable,
  ProColumns,
  ActionType,
} from '@/components/scaffold/SmartTable';
import { FileText } from 'lucide-react';
import { FormSchema } from '@/type/search';
import { AdminOperationLog, AdminOperationLogListParams } from '@/type/types';
import { Card } from '@/components/UIComponents';
import { adminOperationLogApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { format, isValid, parseISO } from 'date-fns';
import {
  buildOperationLogsListParams,
  operationLogsListQueryKey,
  parseOperationLogsSearchParams,
} from '@/lib/cache/operation-logs-cache';

/** Safe date formatter — returns '—' for null, undefined, or invalid dates */
function safeFormat(val: string | null | undefined, fmt: string): string {
  if (!val) return '—';
  const d = parseISO(val);
  return isValid(d) ? format(d, fmt) : '—';
}

interface OperationLogListProps {
  initialFormParams?: Record<string, unknown>;
  onParamsChange?: (params: Record<string, unknown>) => void;
}

export const OperationLogList: React.FC<OperationLogListProps> = ({
  initialFormParams,
  onParamsChange,
}) => {
  const actionRef = useRef<ActionType>(null);

  const hydrationInput = useMemo(() => {
    const input = initialFormParams ?? {};
    return parseOperationLogsSearchParams({
      page: typeof input.page === 'string' ? input.page : undefined,
      pageSize: typeof input.pageSize === 'string' ? input.pageSize : undefined,
      adminId: typeof input.adminId === 'string' ? input.adminId : undefined,
      action: typeof input.action === 'string' ? input.action : undefined,
      keyword: typeof input.keyword === 'string' ? input.keyword : undefined,
      startDate:
        typeof input.startDate === 'string' ? input.startDate : undefined,
      endDate: typeof input.endDate === 'string' ? input.endDate : undefined,
    });
  }, [initialFormParams]);

  const hydrationQueryKey = useMemo(() => {
    return operationLogsListQueryKey(hydrationInput);
  }, [
    hydrationInput.page,
    hydrationInput.pageSize,
    hydrationInput.adminId,
    hydrationInput.action,
    hydrationInput.keyword,
    hydrationInput.startDate,
    hydrationInput.endDate,
  ]);

  // ── SmartTable request（唯一的数据获取入口）────────────────────
  const requestLogs = useCallback(
    async (params: {
      page: number;
      pageSize: number;
      [key: string]: unknown;
    }) => {
      const dateRange = params.dateRange as
        | { from?: string; to?: string }
        | undefined;

      const queryInput = parseOperationLogsSearchParams({
        page: String(params.page ?? 1),
        pageSize: String(params.pageSize ?? 10),
        adminId:
          typeof params.adminId === 'string' ? params.adminId : undefined,
        action: typeof params.action === 'string' ? params.action : undefined,
        keyword:
          typeof params.keyword === 'string' ? params.keyword : undefined,
        startDate:
          typeof params.startDate === 'string'
            ? params.startDate
            : dateRange?.from,
        endDate:
          typeof params.endDate === 'string' ? params.endDate : dateRange?.to,
      });

      const apiParams = buildOperationLogsListParams(
        queryInput,
      ) as AdminOperationLogListParams;

      const res = await adminOperationLogApi.getList(apiParams);
      return { data: res.list, total: res.total };
    },
    [],
  );

  // ── 表格列定义（字段名与 Prisma 模型完全对齐）────────────────────
  const columns: ProColumns<AdminOperationLog>[] = useMemo(
    () => [
      {
        title: 'Admin',
        dataIndex: 'adminName',
        render: (_, row) => (
          <div>
            <div className="font-medium">
              {row.admin?.username || row.adminName}
            </div>
            {row.admin?.realName && (
              <div className="text-xs text-gray-500">{row.admin.realName}</div>
            )}
            <div className="text-xs text-gray-400 font-mono">
              {row.adminId || '—'}
            </div>
          </div>
        ),
      },
      {
        title: 'Module',
        dataIndex: 'module',
        render: (mod) => (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-300">
            {mod as string}
          </span>
        ),
      },
      {
        title: 'Action',
        dataIndex: 'action',
        render: (action) => {
          const colorMap: Record<string, string> = {
            LOGIN: 'bg-green-100 text-green-800',
            LOGOUT: 'bg-gray-100 text-gray-700',
            CREATE: 'bg-blue-100 text-blue-800',
            UPDATE: 'bg-yellow-100 text-yellow-800',
            DELETE: 'bg-red-100 text-red-800',
            AUDIT: 'bg-purple-100 text-purple-800',
            EXPORT: 'bg-orange-100 text-orange-800',
          };
          const cls = colorMap[action as string] || 'bg-gray-100 text-gray-700';
          return (
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}
            >
              {action as string}
            </span>
          );
        },
      },
      {
        title: 'Details',
        dataIndex: 'details',
        render: (details) => (
          <span className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
            {(details as string | null) || '—'}
          </span>
        ),
      },
      {
        title: 'IP Address',
        dataIndex: 'requestIp',
        render: (ip) => (
          <span className="font-mono text-sm text-gray-600 dark:text-gray-400">
            {(ip as string | null) || '—'}
          </span>
        ),
      },
      {
        title: 'Time',
        dataIndex: 'createdAt',
        valueType: 'dateTime',
        render: (_dom, row) => (
          <div className="text-xs text-gray-500 whitespace-nowrap">
            {safeFormat(row.createdAt, 'yyyy-MM-dd HH:mm:ss')}
          </div>
        ),
      },
      {
        title: 'View',
        valueType: 'option',
        width: 70,
        render: (_, row) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              ModalManager.open({
                title: 'Operation Details',
                size: 'md',
                renderChildren: ({ close }) => (
                  <div className="p-4 space-y-3 text-sm">
                    <div>
                      <span className="font-semibold">Admin: </span>
                      {row.admin?.username || row.adminName}
                      {row.admin?.realName ? ` (${row.admin.realName})` : ''}
                    </div>
                    <div>
                      <span className="font-semibold">Module: </span>
                      {row.module}
                    </div>
                    <div>
                      <span className="font-semibold">Action: </span>
                      {row.action}
                    </div>
                    <div>
                      <span className="font-semibold">Details: </span>
                      {row.details || '—'}
                    </div>
                    <div>
                      <span className="font-semibold">IP Address: </span>
                      {row.requestIp || '—'}
                    </div>
                    <div>
                      <span className="font-semibold">Time: </span>
                      {safeFormat(row.createdAt, 'yyyy-MM-dd HH:mm:ss')}
                    </div>
                    <div className="flex justify-end pt-2">
                      <Button onClick={close}>Close</Button>
                    </div>
                  </div>
                ),
              })
            }
          >
            View
          </Button>
        ),
      },
    ],
    [],
  );

  // ── 搜索表单配置 ─────────────────────────────────────────────
  const searchSchema: FormSchema[] = useMemo(
    () => [
      {
        type: 'input',
        key: 'keyword',
        label: 'Keyword',
        placeholder: 'Admin name, module, details…',
      },
      {
        type: 'select',
        key: 'action',
        label: 'Action Type',
        defaultValue: 'ALL',
        options: [
          { label: 'All Actions', value: 'ALL' },
          { label: 'Login', value: 'LOGIN' },
          { label: 'Logout', value: 'LOGOUT' },
          { label: 'Create', value: 'CREATE' },
          { label: 'Update', value: 'UPDATE' },
          { label: 'Delete', value: 'DELETE' },
          { label: 'Audit', value: 'AUDIT' },
          { label: 'Export', value: 'EXPORT' },
        ],
      },
      {
        type: 'date',
        key: 'dateRange',
        label: 'Date Range',
        mode: 'range',
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operation Logs"
        description="Track all administrative actions within the system."
      />
      <Card>
        <div className="p-4">
          <SmartTable<AdminOperationLog>
            headerTitle={
              <div className="flex items-center gap-2">
                <FileText className="text-primary-500" size={20} />
                <span className="font-semibold text-lg">Audit Trail</span>
              </div>
            }
            rowKey="id"
            ref={actionRef}
            columns={columns}
            searchSchema={searchSchema}
            initialFormParams={initialFormParams}
            onParamsChange={onParamsChange}
            request={requestLogs}
            enableHydration={true}
            hydrationQueryKey={hydrationQueryKey}
          />
        </div>
      </Card>
    </div>
  );
};
