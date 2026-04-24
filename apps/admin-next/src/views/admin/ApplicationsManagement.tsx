'use client';

import React, { useState } from 'react';
import { useRequest } from 'ahooks';
import { CheckCircle, XCircle, Clock, MapPin } from 'lucide-react';
import { Badge, Card } from '@/components/UIComponents';
import { Button } from '@repo/ui';
import { useToastStore } from '@/store/useToastStore';
import { applicationApi } from '@/api';
import { AdminApplication, ApplicationStatus } from '@/type/types';
import { useTranslation } from '@/hooks/useTranslation';

const PENDING_APPLICATIONS_UPDATED_EVENT = 'applications:pending-updated';

// ─── Reject modal ─────────────────────────────────────────────────────────────
function RejectModal({
  app,
  onConfirm,
  onClose,
  loading,
  t,
}: {
  app: AdminApplication;
  onConfirm: (note: string) => void;
  onClose: () => void;
  loading: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const [note, setNote] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-dark-900 rounded-2xl p-6 w-full max-w-sm shadow-2xl border border-gray-100 dark:border-white/10">
        <h3 className="font-bold text-lg mb-1 text-gray-900 dark:text-white">
          {t('adminUsers.appRejectTitle')}
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          {t('adminUsers.appRejectDescription', {
            name: app.realName,
            username: app.username,
          })}
        </p>
        <textarea
          className="w-full border border-gray-200 dark:border-white/10 rounded-xl p-3 text-sm bg-gray-50 dark:bg-dark-800 text-gray-900 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-primary-500/40"
          rows={3}
          placeholder={t('adminUsers.appRejectPlaceholder')}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex gap-2 mt-4 justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={loading}
          >
            {t('adminUsers.cancel')}
          </Button>
          <Button
            size="sm"
            className="bg-red-500 hover:bg-red-600 text-white border-0"
            onClick={() => onConfirm(note)}
            isLoading={loading}
          >
            {t('adminUsers.appRejectConfirm')}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({
  status,
  t,
}: {
  status: ApplicationStatus;
  t: (key: string) => string;
}) {
  if (status === 'pending')
    return (
      <Badge color="yellow">
        <Clock size={12} className="inline mr-1" />
        {t('adminUsers.appTabPending')}
      </Badge>
    );
  if (status === 'approved')
    return (
      <Badge color="green">
        <CheckCircle size={12} className="inline mr-1" />
        {t('adminUsers.appTabApproved')}
      </Badge>
    );
  return (
    <Badge color="red">
      <XCircle size={12} className="inline mr-1" />
      {t('adminUsers.appTabRejected')}
    </Badge>
  );
}

// ─── Tab types ────────────────────────────────────────────────────────────────
const TABS = (
  t: (key: string) => string,
): { label: string; value: ApplicationStatus | 'all' }[] => [
  { label: t('adminUsers.appTabPending'), value: 'pending' },
  { label: t('adminUsers.appTabApproved'), value: 'approved' },
  { label: t('adminUsers.appTabRejected'), value: 'rejected' },
  { label: t('adminUsers.appTabAll'), value: 'all' },
];

// ─── Main component ───────────────────────────────────────────────────────────
export function ApplicationsManagement() {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [tab, setTab] = useState<ApplicationStatus | 'all'>('pending');
  const [page, setPage] = useState(1);
  const [rejectTarget, setRejectTarget] = useState<AdminApplication | null>(
    null,
  );

  // Fetch list
  const { data, loading, refresh } = useRequest(
    () => applicationApi.getList({ page, pageSize: 20, status: tab }),
    { refreshDeps: [tab, page] },
  );

  // Pending count for badge
  const { data: countData, refresh: refreshCount } = useRequest(
    () => applicationApi.pendingCount(),
    { refreshDeps: [] },
  );

  // Approve
  const { loading: approving, run: runApprove } = useRequest(
    (id: string) => applicationApi.approve(id),
    {
      manual: true,
      onSuccess: (res) => {
        addToast('success', res.message);
        refresh();
        refreshCount();
        window.dispatchEvent(new Event(PENDING_APPLICATIONS_UPDATED_EVENT));
      },
      onError: (err) => addToast('error', err.message),
    },
  );

  // Reject
  const { loading: rejecting, run: runReject } = useRequest(
    (id: string, note: string) => applicationApi.reject(id, note),
    {
      manual: true,
      onSuccess: () => {
        addToast('success', t('adminUsers.appRejected'));
        setRejectTarget(null);
        refresh();
        refreshCount();
        window.dispatchEvent(new Event(PENDING_APPLICATIONS_UPDATED_EVENT));
      },
      onError: (err) => addToast('error', err.message),
    },
  );

  const pendingCount = countData?.count ?? 0;
  const list: AdminApplication[] = data?.list ?? [];
  const total: number = data?.total ?? 0;

  return (
    <div className="space-y-5">
      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-gray-100 dark:bg-dark-800 rounded-xl w-fit">
        {TABS(t).map((tabItem) => (
          <button
            key={tabItem.value}
            onClick={() => {
              setTab(tabItem.value);
              setPage(1);
            }}
            className={`relative px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === tabItem.value
                ? 'bg-white dark:bg-dark-900 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {tabItem.label}
            {tabItem.value === 'pending' && pendingCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] text-[10px] font-bold bg-red-500 text-white rounded-full flex items-center justify-center px-1">
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      <Card>
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">
            {t('adminUsers.appLoading')}
          </div>
        ) : list.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">
            {t('adminUsers.appNoResults')}
          </div>
        ) : (
          <div className="space-y-3">
            {list.map((app) => (
              <div
                key={app.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-gray-100 dark:border-white/5 hover:border-gray-200 dark:hover:border-white/10 transition-colors"
              >
                {/* Left: info */}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900 dark:text-white">
                      {app.realName}
                    </span>
                    <span className="font-mono text-xs text-gray-500 bg-gray-100 dark:bg-dark-800 px-2 py-0.5 rounded">
                      @{app.username}
                    </span>
                    <StatusBadge status={app.status} t={t} />
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400 truncate">
                    {app.email}
                  </div>
                  {app.applyReason && (
                    <div className="text-xs text-gray-400 italic truncate">
                      &ldquo;{app.applyReason}&rdquo;
                    </div>
                  )}
                  <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                    <span>{new Date(app.createdAt).toLocaleString()}</span>
                    {app.applyIp && (
                      <span className="flex items-center gap-1">
                        <MapPin size={11} /> {app.applyIp}
                      </span>
                    )}
                    {app.reviewNote && (
                      <span className="text-red-400">
                        {t('adminUsers.appNote', { note: app.reviewNote })}
                      </span>
                    )}
                  </div>
                </div>

                {/* Right: actions */}
                {app.status === 'pending' && (
                  <div className="flex gap-2 flex-shrink-0">
                    <Button
                      size="sm"
                      className="bg-green-500 hover:bg-green-600 text-white border-0"
                      onClick={() => runApprove(app.id)}
                      isLoading={approving}
                    >
                      <CheckCircle size={14} className="mr-1" />{' '}
                      {t('adminUsers.appApprove')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-500 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20"
                      onClick={() => setRejectTarget(app)}
                    >
                      <XCircle size={14} className="mr-1" />{' '}
                      {t('adminUsers.appReject')}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Simple pagination */}
        {total > 20 && (
          <div className="flex justify-between items-center mt-4 pt-4 border-t border-gray-100 dark:border-white/5">
            <span className="text-sm text-gray-500">
              {t('adminUsers.appTotal', { count: total })}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                {t('adminUsers.appPrev')}
              </Button>
              <span className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400">
                {t('adminUsers.appPage', { page })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page * 20 >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('adminUsers.appNext')}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Reject modal */}
      {rejectTarget && (
        <RejectModal
          app={rejectTarget}
          onConfirm={(note) => runReject(rejectTarget.id, note)}
          onClose={() => setRejectTarget(null)}
          loading={rejecting}
          t={t}
        />
      )}
    </div>
  );
}
