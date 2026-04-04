'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  LogIn,
  Search,
  RefreshCw,
  CheckCircle,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Globe,
  Smartphone,
  Shield,
} from 'lucide-react';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { loginLogApi } from '@/api';
import type { QueryLoginLogParams, UserLoginLog } from '@/type/types';
import { format } from 'date-fns';
import {
  buildLoginLogsListParams,
  loginLogsListQueryKey,
  parseLoginLogsSearchParams,
} from '@/lib/cache/login-logs-cache';

const LOGIN_METHODS: Record<string, string> = {
  password: 'Password',
  google: 'Google',
  facebook: 'Facebook',
  apple: 'Apple',
};

const LOGIN_TYPE_LABELS: Record<number, string> = {
  1: 'Password',
  2: 'SMS OTP',
  3: 'Social',
};

function StatusBadge({ status }: { status: number }) {
  if (status === 1) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400">
        <CheckCircle size={10} />
        Success
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-500/20 text-red-500 dark:text-red-400">
      <XCircle size={10} />
      Failed
    </span>
  );
}

function LogRow({ log }: { log: UserLoginLog }) {
  return (
    <tr className="border-b border-gray-50 dark:border-white/5 hover:bg-gray-50/50 dark:hover:bg-white/3 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
            {log.userNickname?.charAt(0).toUpperCase() ?? '?'}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {log.userNickname ?? 'Unknown'}
            </p>
            <p className="text-xs text-gray-400 font-mono">
              {log.userId.slice(0, 10)}…
            </p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="text-sm text-gray-700 dark:text-gray-300">
          {format(new Date(log.loginTime), 'MM/dd HH:mm:ss')}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
          <Globe size={13} className="text-gray-400" />
          <span className="font-mono">{log.loginIp ?? '—'}</span>
        </div>
        {(log.countryCode || log.city) && (
          <div className="text-xs text-gray-400 mt-0.5">
            {[log.city, log.countryCode].filter(Boolean).join(', ')}
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400">
          <Shield size={10} />
          {LOGIN_TYPE_LABELS[log.loginType] ?? `Type ${log.loginType}`}
        </span>
        {log.loginMethod && (
          <div className="text-xs text-gray-400 mt-0.5">
            {LOGIN_METHODS[log.loginMethod] ?? log.loginMethod}
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
          <Smartphone size={12} />
          <span className="truncate max-w-32">{log.loginDevice ?? '—'}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={log.loginStatus} />
        {log.failReason && (
          <p
            className="text-xs text-red-400 mt-0.5 max-w-36 truncate"
            title={log.failReason}
          >
            {log.failReason}
          </p>
        )}
      </td>
    </tr>
  );
}

export function LoginLogList() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialQueryInput = useMemo(() => {
    const params: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      params[key] = value;
    });
    return parseLoginLogsSearchParams(params);
  }, [searchParams]);

  const [params, setParams] = useState<QueryLoginLogParams>(initialQueryInput);
  const [userId, setUserId] = useState(initialQueryInput.userId ?? '');
  const [loginIp, setLoginIp] = useState(initialQueryInput.loginIp ?? '');
  const [loginStatus, setLoginStatus] = useState<number | undefined>(
    initialQueryInput.loginStatus,
  );

  const syncUrl = useCallback(
    (nextParams: QueryLoginLogParams) => {
      const qs = new URLSearchParams();
      const serialized = buildLoginLogsListParams(
        parseLoginLogsSearchParams({
          page: String(nextParams.page ?? 1),
          pageSize: String(nextParams.pageSize ?? 20),
          userId: nextParams.userId,
          loginIp: nextParams.loginIp,
          loginMethod: nextParams.loginMethod,
          loginStatus:
            nextParams.loginStatus !== undefined
              ? String(nextParams.loginStatus)
              : undefined,
          startDate: nextParams.startDate,
          endDate: nextParams.endDate,
        }),
      );

      Object.entries(serialized).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
          return;
        }
        if (key === 'page' && Number(value) === 1) {
          return;
        }
        if (key === 'pageSize' && Number(value) === 20) {
          return;
        }
        qs.set(key, String(value));
      });

      const nextUrl = qs.toString()
        ? `/login-logs?${qs.toString()}`
        : '/login-logs';
      router.replace(nextUrl, { scroll: false });
    },
    [router],
  );

  const { data, isFetching, refetch } = useQuery<{
    list: UserLoginLog[];
    total: number;
  }>({
    queryKey: loginLogsListQueryKey(
      parseLoginLogsSearchParams({
        page: String(params.page ?? 1),
        pageSize: String(params.pageSize ?? 20),
        userId: params.userId,
        loginIp: params.loginIp,
        loginMethod: params.loginMethod,
        loginStatus:
          params.loginStatus !== undefined
            ? String(params.loginStatus)
            : undefined,
        startDate: params.startDate,
        endDate: params.endDate,
      }),
    ),
    queryFn: async () => {
      const res = await loginLogApi.getList(params);
      return { list: res.list, total: res.total };
    },
    staleTime: 30_000,
  });

  const loading = isFetching;

  const logs = data?.list ?? [];
  const total = data?.total ?? 0;
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  const totalPages = Math.ceil(total / pageSize);

  const applyFilters = useCallback(() => {
    setParams((p) => {
      const nextParams = {
        ...p,
        page: 1,
        userId: userId || undefined,
        loginIp: loginIp || undefined,
        loginStatus,
      };
      syncUrl(nextParams);
      return nextParams;
    });
  }, [loginIp, loginStatus, syncUrl, userId]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Login Logs"
        description="Security audit: user login history and access records"
      />

      {/* 筛选栏 */}
      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-gray-900 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 dark:text-gray-400">
              User ID
            </label>
            <div className="relative">
              <Search
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="User ID…"
                className="pl-8 pr-3 py-2 text-sm rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-900 dark:text-white w-48 focus:outline-none focus:ring-2 focus:ring-teal-500/50"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 dark:text-gray-400">
              IP Address
            </label>
            <input
              value={loginIp}
              onChange={(e) => setLoginIp(e.target.value)}
              placeholder="IP…"
              className="px-3 py-2 text-sm rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-900 dark:text-white w-36 focus:outline-none focus:ring-2 focus:ring-teal-500/50"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 dark:text-gray-400">
              Status
            </label>
            <select
              value={loginStatus ?? ''}
              onChange={(e) =>
                setLoginStatus(
                  e.target.value === '' ? undefined : Number(e.target.value),
                )
              }
              className="px-3 py-2 text-sm rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-900 dark:text-white w-32 focus:outline-none focus:ring-2 focus:ring-teal-500/50"
            >
              <option value="">All</option>
              <option value="1">Success</option>
              <option value="0">Failed</option>
            </select>
          </div>
          <button
            onClick={applyFilters}
            className="px-4 py-2 text-sm bg-teal-500 hover:bg-teal-600 text-white rounded-xl transition-colors"
          >
            Search
          </button>
          <button
            onClick={() => void refetch()}
            disabled={loading}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* 表格 */}
      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-gray-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-white/10 bg-gray-50/50 dark:bg-white/3">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">
                  User
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">
                  Time
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">
                  IP / Location
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">
                  Method
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">
                  Device
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && logs.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-12 text-center text-gray-400"
                  >
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && logs.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-12 text-center text-gray-400"
                  >
                    <LogIn size={32} className="mx-auto mb-2 opacity-30" />
                    No login logs found
                  </td>
                </tr>
              )}
              {logs.map((log) => (
                <LogRow key={log.id} log={log} />
              ))}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        {total > pageSize && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-white/10">
            <span className="text-xs text-gray-400">
              {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of{' '}
              {total}
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => {
                  setParams((p) => {
                    const nextParams = { ...p, page: (p.page ?? 1) - 1 };
                    syncUrl(nextParams);
                    return nextParams;
                  });
                }}
                className="p-1.5 rounded-lg bg-gray-100 dark:bg-white/5 disabled:opacity-40 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {page} / {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => {
                  setParams((p) => {
                    const nextParams = { ...p, page: (p.page ?? 1) + 1 };
                    syncUrl(nextParams);
                    return nextParams;
                  });
                }}
                className="p-1.5 rounded-lg bg-gray-100 dark:bg-white/5 disabled:opacity-40 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
