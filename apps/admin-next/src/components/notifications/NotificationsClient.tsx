'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useRequest } from 'ahooks';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Send,
  Users,
  Smartphone,
  Wifi,
  Activity,
  CheckCircle,
  XCircle,
  Radio,
  User,
} from 'lucide-react';
import { Card, Badge } from '@/components/UIComponents';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { notificationApi } from '@/api';
import type { AdminPushLog, QueryPushLogParams } from '@/type/types';
import { format } from 'date-fns';
import { useTranslation } from '@/hooks/useTranslation';
import type { TFunc } from '@/hooks/useTranslation';

// ─── Zod schemas (factory functions) ─────────────────────────────
function createBroadcastSchema(t: TFunc) {
  return z.object({
    title: z
      .string()
      .min(1, t('notifications.validationTitleRequired'))
      .max(200),
    body: z
      .string()
      .min(1, t('notifications.validationBodyRequired'))
      .max(1000),
  });
}

function createTargetedSchema(t: TFunc) {
  return z.object({
    targetUserId: z
      .string()
      .min(1, t('notifications.validationUserIdRequired')),
    title: z
      .string()
      .min(1, t('notifications.validationTitleRequired'))
      .max(200),
    body: z
      .string()
      .min(1, t('notifications.validationBodyRequired'))
      .max(1000),
  });
}

type BroadcastForm = z.infer<ReturnType<typeof createBroadcastSchema>>;
type TargetedForm = z.infer<ReturnType<typeof createTargetedSchema>>;

// ─── Device Stat Card ─────────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className={`flex items-center gap-3 p-4 rounded-xl border ${color}`}>
      <div className="p-2 rounded-lg bg-white/10">{icon}</div>
      <div>
        <p className="text-2xl font-bold">{value.toLocaleString()}</p>
        <p className="text-xs opacity-75">{label}</p>
      </div>
    </div>
  );
}

// ─── Push Log Row ──────────────────────────────────────────────────────────────
function PushLogRow({ log, t }: { log: AdminPushLog; t: TFunc }) {
  const isBroadcast = log.type === 'broadcast';
  return (
    <div className="flex items-start gap-3 p-4 border-b border-gray-100 dark:border-white/5 last:border-0 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
      <div
        className={`mt-0.5 p-1.5 rounded-full ${isBroadcast ? 'bg-indigo-100 dark:bg-indigo-500/20' : 'bg-sky-100 dark:bg-sky-500/20'}`}
      >
        {isBroadcast ? (
          <Radio size={14} className="text-indigo-600 dark:text-indigo-400" />
        ) : (
          <User size={14} className="text-sky-600 dark:text-sky-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">{log.title}</span>
          <Badge color={log.status === 'sent' ? 'green' : 'red'}>
            {log.status === 'sent' ? (
              <>
                <CheckCircle size={10} className="mr-1" />
                {t('notifications.statusSent')}
              </>
            ) : (
              <>
                <XCircle size={10} className="mr-1" />
                {t('notifications.statusFailed')}
              </>
            )}
          </Badge>
          <Badge color="gray">
            {isBroadcast
              ? t('notifications.typeBroadcast')
              : t('notifications.typeTargeted')}
          </Badge>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
          {log.body}
        </p>
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
          <span>{t('notifications.sentBy', { name: log.adminName })}</span>
          {log.targetUserId && <span>→ {log.targetUserId}</span>}
          <span>
            ✓{log.successCount} ✗{log.failureCount}
          </span>
          <span>{format(new Date(log.createdAt), 'MM/dd HH:mm')}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function NotificationManagement() {
  const { t } = useTranslation();

  const broadcastSchema = useMemo(() => createBroadcastSchema(t), [t]);
  const targetedSchema = useMemo(() => createTargetedSchema(t), [t]);

  const [activeTab, setActiveTab] = useState<'broadcast' | 'targeted' | 'logs'>(
    'broadcast',
  );
  const [logFilter, setLogFilter] = useState<QueryPushLogParams>({
    page: 1,
    pageSize: 20,
  });
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  // ── Device stats ───────────────────────────────────────────────────────────
  const [deviceStats, setDeviceStats] = useState<{
    total: number;
    android: number;
    ios: number;
    web: number;
    activeInLast7Days: number;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    notificationApi.getDeviceStats().then((data) => {
      if (!cancelled) setDeviceStats(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Push logs ──────────────────────────────────────────────────────────────
  const {
    data: logsData,
    loading: logsLoading,
    refresh: refreshLogs,
  } = useRequest(() => notificationApi.getLogs(logFilter), {
    refreshDeps: [logFilter],
  });

  // ── Broadcast form ─────────────────────────────────────────────────────────
  const {
    register: bcRegister,
    handleSubmit: bcHandleSubmit,
    reset: bcReset,
    formState: { errors: bcErrors },
  } = useForm<BroadcastForm>({
    resolver: zodResolver(broadcastSchema),
    defaultValues: { title: '', body: '' },
  });

  const { loading: bcLoading, run: sendBroadcast } = useRequest(
    (data: BroadcastForm) => notificationApi.sendBroadcast(data),
    {
      manual: true,
      onSuccess: () => {
        setSendSuccess(t('notifications.toastBroadcastSuccess'));
        setSendError(null);
        bcReset();
        setTimeout(() => setSendSuccess(null), 4000);
        if (activeTab === 'logs') refreshLogs();
      },
      onError: (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setSendError(message || t('notifications.toastBroadcastError'));
        setSendSuccess(null);
      },
    },
  );

  // ── Targeted form ──────────────────────────────────────────────────────────
  const {
    register: tgRegister,
    handleSubmit: tgHandleSubmit,
    reset: tgReset,
    formState: { errors: tgErrors },
  } = useForm<TargetedForm>({
    resolver: zodResolver(targetedSchema),
    defaultValues: { targetUserId: '', title: '', body: '' },
  });

  const { loading: tgLoading, run: sendTargeted } = useRequest(
    (data: TargetedForm) => notificationApi.sendTargeted(data),
    {
      manual: true,
      onSuccess: () => {
        setSendSuccess(t('notifications.toastTargetedSuccess'));
        setSendError(null);
        tgReset();
        setTimeout(() => setSendSuccess(null), 4000);
        if (activeTab === 'logs') refreshLogs();
      },
      onError: (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setSendError(message || t('notifications.toastTargetedError'));
        setSendSuccess(null);
      },
    },
  );

  const handleLogFilterChange = useCallback((type: string) => {
    setLogFilter((prev) => ({
      ...prev,
      type: type === 'ALL' ? undefined : type,
      page: 1,
    }));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('notifications.pageTitle')}
        description={t('notifications.pageDescription')}
      />

      {/* Device Stats */}
      {deviceStats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard
            label={t('notifications.statTotalDevices')}
            value={deviceStats.total}
            icon={<Smartphone size={16} className="text-gray-600" />}
            color="bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300"
          />
          <StatCard
            label={t('notifications.statAndroid')}
            value={deviceStats.android}
            icon={<Smartphone size={16} className="text-green-600" />}
            color="bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/20 text-green-700 dark:text-green-400"
          />
          <StatCard
            label={t('notifications.statIos')}
            value={deviceStats.ios}
            icon={<Smartphone size={16} className="text-blue-600" />}
            color="bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20 text-blue-700 dark:text-blue-400"
          />
          <StatCard
            label={t('notifications.statWeb')}
            value={deviceStats.web}
            icon={<Wifi size={16} className="text-purple-600" />}
            color="bg-purple-50 dark:bg-purple-500/10 border-purple-200 dark:border-purple-500/20 text-purple-700 dark:text-purple-400"
          />
          <StatCard
            label={t('notifications.statActive7d')}
            value={deviceStats.activeInLast7Days}
            icon={<Activity size={16} className="text-amber-600" />}
            color="bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400"
          />
        </div>
      )}

      {/* Feedback banners */}
      {sendSuccess && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 text-green-700 dark:text-green-400 text-sm">
          <CheckCircle size={16} /> {sendSuccess}
        </div>
      )}
      {sendError && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 text-sm">
          <XCircle size={16} /> {sendError}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-white/5 p-1 rounded-xl w-fit">
        {(['broadcast', 'targeted', 'logs'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab);
              if (tab === 'logs') refreshLogs();
            }}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab
                ? 'bg-white dark:bg-white/10 shadow-sm text-gray-900 dark:text-white'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {tab === 'broadcast'
              ? t('notifications.tabBroadcast')
              : tab === 'targeted'
                ? t('notifications.tabTargeted')
                : t('notifications.tabLogs')}
          </button>
        ))}
      </div>

      {/* Broadcast Tab */}
      {activeTab === 'broadcast' && (
        <Card className="p-6 max-w-2xl">
          <div className="flex items-center gap-2 mb-5">
            <Radio size={18} className="text-indigo-500" />
            <h3 className="font-semibold text-lg">
              {t('notifications.broadcastTitle')}
            </h3>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t('notifications.broadcastHint')}
            </span>
          </div>
          <form
            onSubmit={bcHandleSubmit((data) => sendBroadcast(data))}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium mb-1">
                {t('notifications.pushTitle')}{' '}
                <span className="text-red-500">*</span>
              </label>
              <input
                {...bcRegister('title')}
                placeholder={t('notifications.broadcastTitlePlaceholder')}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              />
              {bcErrors.title && (
                <p className="text-red-500 text-xs mt-1">
                  {bcErrors.title.message}
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                {t('notifications.pushBody')}{' '}
                <span className="text-red-500">*</span>
              </label>
              <textarea
                {...bcRegister('body')}
                rows={4}
                placeholder={t('notifications.pushBodyPlaceholder')}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 resize-none"
              />
              {bcErrors.body && (
                <p className="text-red-500 text-xs mt-1">
                  {bcErrors.body.message}
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={bcLoading}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-medium transition-colors"
            >
              <Send size={14} />
              {bcLoading
                ? t('notifications.sending')
                : t('notifications.sendBroadcast')}
            </button>
          </form>
        </Card>
      )}

      {/* Targeted Tab */}
      {activeTab === 'targeted' && (
        <Card className="p-6 max-w-2xl">
          <div className="flex items-center gap-2 mb-5">
            <User size={18} className="text-sky-500" />
            <h3 className="font-semibold text-lg">
              {t('notifications.targetedTitle')}
            </h3>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t('notifications.targetedHint')}
            </span>
          </div>
          <form
            onSubmit={tgHandleSubmit((data) => sendTargeted(data))}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium mb-1">
                {t('notifications.targetUserId')}{' '}
                <span className="text-red-500">*</span>
              </label>
              <input
                {...tgRegister('targetUserId')}
                placeholder={t('notifications.targetUserIdPlaceholder')}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500/30"
              />
              {tgErrors.targetUserId && (
                <p className="text-red-500 text-xs mt-1">
                  {tgErrors.targetUserId.message}
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                {t('notifications.pushTitle')}{' '}
                <span className="text-red-500">*</span>
              </label>
              <input
                {...tgRegister('title')}
                placeholder={t('notifications.targetedTitlePlaceholder')}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/30"
              />
              {tgErrors.title && (
                <p className="text-red-500 text-xs mt-1">
                  {tgErrors.title.message}
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                {t('notifications.pushBody')}{' '}
                <span className="text-red-500">*</span>
              </label>
              <textarea
                {...tgRegister('body')}
                rows={4}
                placeholder={t('notifications.pushBodyPlaceholder')}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/30 resize-none"
              />
              {tgErrors.body && (
                <p className="text-red-500 text-xs mt-1">
                  {tgErrors.body.message}
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={tgLoading}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-sm font-medium transition-colors"
            >
              <Send size={14} />
              {tgLoading
                ? t('notifications.sending')
                : t('notifications.sendTargeted')}
            </button>
          </form>
        </Card>
      )}

      {/* Logs Tab */}
      {activeTab === 'logs' && (
        <Card className="overflow-hidden">
          {/* Filter bar */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-white/5">
            <Users size={15} className="text-gray-400" />
            <span className="text-sm font-medium">
              {t('notifications.logsTitle')}
            </span>
            <div className="ml-auto flex gap-1">
              {['ALL', 'broadcast', 'targeted'].map((ft) => (
                <button
                  key={ft}
                  onClick={() => handleLogFilterChange(ft)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                    (logFilter.type ?? 'ALL') === ft
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10'
                  }`}
                >
                  {ft === 'ALL'
                    ? t('notifications.filterAll')
                    : ft === 'broadcast'
                      ? t('notifications.filterBroadcast')
                      : t('notifications.filterTargeted')}
                </button>
              ))}
              <button
                onClick={refreshLogs}
                className="px-3 py-1 rounded-lg text-xs font-medium bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
              >
                {t('notifications.refresh')}
              </button>
            </div>
          </div>

          {/* Log list */}
          {logsLoading ? (
            <div className="p-8 text-center text-gray-400 text-sm">
              {t('notifications.loading')}
            </div>
          ) : logsData?.list?.length ? (
            <>
              {logsData.list.map((log) => (
                <PushLogRow key={log.id} log={log} t={t} />
              ))}
              <div className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100 dark:border-white/5">
                {t('notifications.totalRecords', {
                  count: logsData.total,
                })}
              </div>
            </>
          ) : (
            <div className="p-8 text-center text-gray-400 text-sm">
              {t('notifications.noLogs')}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
