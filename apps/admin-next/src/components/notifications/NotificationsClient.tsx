'use client';

import React, { useState, useCallback } from 'react';
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
import { useAppStore } from '@/store/useAppStore';

const NOTIFICATION_I18N = {
  en: {
    pageTitle: 'Notifications / Push Management',
    pageDescription:
      'Firebase Cloud Messaging - broadcast to all users or target specific users',
    broadcastTitle: 'Broadcast',
    broadcastHint: '- Send to all subscribed devices via Firebase Topic',
    pushTitle: 'Push Title',
    pushBody: 'Push Body',
    broadcastTitlePlaceholder: 'e.g. New campaign is live!',
    pushBodyPlaceholder: 'Notification content...',
    sending: 'Sending...',
    sendBroadcast: 'Send Broadcast',
    targetedTitle: 'Targeted Push',
    targetedHint: '- Send to all bound devices of a specific user',
    targetUserId: 'Target User ID',
    targetUserIdPlaceholder: 'Enter user ID',
    targetedTitlePlaceholder: 'e.g. Your order has been shipped',
    sendTargeted: 'Send Push',
    logsTitle: 'Push History',
  },
  zh: {
    pageTitle: '通知 / 推送管理',
    pageDescription:
      'Firebase Cloud Messaging - 向所有用户广播或向指定用户推送通知',
    broadcastTitle: '全员广播',
    broadcastHint: '- 通过 Firebase Topic 发给所有订阅设备',
    pushTitle: '推送标题',
    pushBody: '推送内容',
    broadcastTitlePlaceholder: 'e.g. 新活动上线了！',
    pushBodyPlaceholder: '通知正文内容...',
    sending: '发送中...',
    sendBroadcast: '发送广播',
    targetedTitle: '定向推送',
    targetedHint: '- 向指定用户的所有绑定设备发送',
    targetUserId: '目标用户 ID',
    targetUserIdPlaceholder: '输入用户 ID',
    targetedTitlePlaceholder: 'e.g. 您的订单已发货',
    sendTargeted: '发送推送',
    logsTitle: '推送历史',
  },
} as const;

// ─── Zod schemas (no .default(), no .transform()) ─────────────────────────────
const broadcastSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  body: z.string().min(1, 'Body is required').max(1000),
});

const targetedSchema = z.object({
  targetUserId: z.string().min(1, 'User ID is required'),
  title: z.string().min(1, 'Title is required').max(200),
  body: z.string().min(1, 'Body is required').max(1000),
});

type BroadcastForm = z.infer<typeof broadcastSchema>;
type TargetedForm = z.infer<typeof targetedSchema>;

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
function PushLogRow({ log }: { log: AdminPushLog }) {
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
                Sent
              </>
            ) : (
              <>
                <XCircle size={10} className="mr-1" />
                Failed
              </>
            )}
          </Badge>
          <Badge color="gray">{isBroadcast ? 'Broadcast' : 'Targeted'}</Badge>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
          {log.body}
        </p>
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
          <span>By {log.adminName}</span>
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
  const lang = useAppStore((s) => s.lang);
  const t = NOTIFICATION_I18N[lang];
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
  const { data: deviceStats } = useRequest(
    () => notificationApi.getDeviceStats(),
    { cacheKey: 'notification-device-stats' },
  );

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
        setSendSuccess('Broadcast sent successfully!');
        setSendError(null);
        bcReset();
        setTimeout(() => setSendSuccess(null), 4000);
        if (activeTab === 'logs') refreshLogs();
      },
      onError: (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setSendError(message || 'Failed to send broadcast');
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
        setSendSuccess('Targeted push sent successfully!');
        setSendError(null);
        tgReset();
        setTimeout(() => setSendSuccess(null), 4000);
        if (activeTab === 'logs') refreshLogs();
      },
      onError: (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setSendError(message || 'Failed to send targeted push');
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
      <PageHeader title={t.pageTitle} description={t.pageDescription} />

      {/* Device Stats */}
      {deviceStats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard
            label="Total Devices"
            value={deviceStats.total}
            icon={<Smartphone size={16} className="text-gray-600" />}
            color="bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300"
          />
          <StatCard
            label="Android"
            value={deviceStats.android}
            icon={<Smartphone size={16} className="text-green-600" />}
            color="bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/20 text-green-700 dark:text-green-400"
          />
          <StatCard
            label="iOS"
            value={deviceStats.ios}
            icon={<Smartphone size={16} className="text-blue-600" />}
            color="bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20 text-blue-700 dark:text-blue-400"
          />
          <StatCard
            label="Web"
            value={deviceStats.web}
            icon={<Wifi size={16} className="text-purple-600" />}
            color="bg-purple-50 dark:bg-purple-500/10 border-purple-200 dark:border-purple-500/20 text-purple-700 dark:text-purple-400"
          />
          <StatCard
            label="Active (7d)"
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
              ? '📢 Broadcast'
              : tab === 'targeted'
                ? '🎯 Targeted'
                : '📋 Logs'}
          </button>
        ))}
      </div>

      {/* Broadcast Tab */}
      {activeTab === 'broadcast' && (
        <Card className="p-6 max-w-2xl">
          <div className="flex items-center gap-2 mb-5">
            <Radio size={18} className="text-indigo-500" />
            <h3 className="font-semibold text-lg">{t.broadcastTitle}</h3>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t.broadcastHint}
            </span>
          </div>
          <form
            onSubmit={bcHandleSubmit((data) => sendBroadcast(data))}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium mb-1">
                {t.pushTitle} <span className="text-red-500">*</span>
              </label>
              <input
                {...bcRegister('title')}
                placeholder={t.broadcastTitlePlaceholder}
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
                {t.pushBody} <span className="text-red-500">*</span>
              </label>
              <textarea
                {...bcRegister('body')}
                rows={4}
                placeholder={t.pushBodyPlaceholder}
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
              {bcLoading ? t.sending : t.sendBroadcast}
            </button>
          </form>
        </Card>
      )}

      {/* Targeted Tab */}
      {activeTab === 'targeted' && (
        <Card className="p-6 max-w-2xl">
          <div className="flex items-center gap-2 mb-5">
            <User size={18} className="text-sky-500" />
            <h3 className="font-semibold text-lg">{t.targetedTitle}</h3>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t.targetedHint}
            </span>
          </div>
          <form
            onSubmit={tgHandleSubmit((data) => sendTargeted(data))}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium mb-1">
                {t.targetUserId} <span className="text-red-500">*</span>
              </label>
              <input
                {...tgRegister('targetUserId')}
                placeholder={t.targetUserIdPlaceholder}
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
                {t.pushTitle} <span className="text-red-500">*</span>
              </label>
              <input
                {...tgRegister('title')}
                placeholder={t.targetedTitlePlaceholder}
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
                {t.pushBody} <span className="text-red-500">*</span>
              </label>
              <textarea
                {...tgRegister('body')}
                rows={4}
                placeholder={t.pushBodyPlaceholder}
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
              {tgLoading ? t.sending : t.sendTargeted}
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
            <span className="text-sm font-medium">{t.logsTitle}</span>
            <div className="ml-auto flex gap-1">
              {['ALL', 'broadcast', 'targeted'].map((t) => (
                <button
                  key={t}
                  onClick={() => handleLogFilterChange(t)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                    (logFilter.type ?? 'ALL') === t
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10'
                  }`}
                >
                  {t === 'ALL' ? 'All' : t}
                </button>
              ))}
              <button
                onClick={refreshLogs}
                className="px-3 py-1 rounded-lg text-xs font-medium bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
              >
                ↻ Refresh
              </button>
            </div>
          </div>

          {/* Log list */}
          {logsLoading ? (
            <div className="p-8 text-center text-gray-400 text-sm">
              Loading...
            </div>
          ) : logsData?.list?.length ? (
            <>
              {logsData.list.map((log) => (
                <PushLogRow key={log.id} log={log} />
              ))}
              <div className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100 dark:border-white/5">
                Total: {logsData.total} records
              </div>
            </>
          ) : (
            <div className="p-8 text-center text-gray-400 text-sm">
              No push logs yet.
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
