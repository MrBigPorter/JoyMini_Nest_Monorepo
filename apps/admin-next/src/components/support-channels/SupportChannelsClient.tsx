'use client';

import React, { useMemo, useState } from 'react';
import { useRequest } from 'ahooks';
import { chatApi, supportChannelApi } from '@/api';
import {
  SENTRY_SPAN_ATTR_KEY,
  SENTRY_SPAN_NAME,
} from '@/lib/sentry-span-constants';
import { withUiActionSpan } from '@/lib/sentry-span';
import type {
  CreateSupportChannelPayload,
  QuerySupportChannelsParams,
  SupportChannelItem,
  SupportChannelsResult,
  UpdateSupportChannelPayload,
} from '@/type/types';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { SmartImage } from '@/components/ui/SmartImage';
import { useToastStore } from '@/store/useToastStore';

type FilterStatus = 'ALL' | 'ACTIVE' | 'INACTIVE';
type BusinessIdMode = 'builtin' | 'custom';

const BUILTIN_BUSINESS_IDS = [
  'official_platform_support_v1',
  'tech_support_v1',
  'vip_support_v1',
];

const DEFAULT_FORM: CreateSupportChannelPayload = {
  id: '',
  name: '',
  description: '',
  avatar: '',
};

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

interface SupportChannelsProps {
  initialData?: SupportChannelsResult;
  initialQuery?: QuerySupportChannelsParams;
}

export function SupportChannels({
  initialData,
  initialQuery,
}: SupportChannelsProps) {
  const addToast = useToastStore((s) => s.addToast);
  const initialPage = initialQuery?.page ?? 1;
  const initialPageSize = initialQuery?.pageSize ?? 20;
  const initialKeyword = initialQuery?.keyword ?? '';
  const initialStatus: FilterStatus =
    initialQuery?.isActive === undefined
      ? 'ALL'
      : initialQuery.isActive
        ? 'ACTIVE'
        : 'INACTIVE';

  const [page, setPage] = useState(initialPage);
  const [keyword, setKeyword] = useState(initialKeyword);
  const [status, setStatus] = useState<FilterStatus>(initialStatus);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [businessIdMode, setBusinessIdMode] =
    useState<BusinessIdMode>('builtin');
  const [builtinBusinessId, setBuiltinBusinessId] = useState(
    BUILTIN_BUSINESS_IDS[0],
  );
  const [form, setForm] = useState<CreateSupportChannelPayload>(DEFAULT_FORM);

  const query = useMemo<QuerySupportChannelsParams>(() => {
    return {
      page,
      pageSize: initialPageSize,
      keyword: keyword || undefined,
      isActive: status === 'ALL' ? undefined : status === 'ACTIVE',
    };
  }, [page, initialPageSize, keyword, status]);

  const isInitialQuery =
    page === initialPage &&
    keyword === initialKeyword &&
    status === initialStatus;

  const hasServerPrefetch = Boolean(initialData);

  const {
    data,
    loading,
    run: refresh,
  } = useRequest(() => supportChannelApi.getList(query), {
    ready: !(hasServerPrefetch && isInitialQuery),
    refreshDeps: [page, keyword, status],
  });

  const effectiveData = data ?? (isInitialQuery ? initialData : undefined);
  const list = effectiveData?.list ?? [];

  const onCreate = async () => {
    const finalBusinessId =
      businessIdMode === 'builtin' ? builtinBusinessId : form.id.trim();

    if (!finalBusinessId || !form.name.trim()) {
      addToast('error', 'Channel ID and Name are required');
      return;
    }
    setSubmitting(true);
    try {
      await withUiActionSpan(
        SENTRY_SPAN_NAME.SUPPORT_CHANNEL_CREATE,
        {
          [SENTRY_SPAN_ATTR_KEY.SUPPORT_BUSINESS_ID_MODE]: businessIdMode,
          [SENTRY_SPAN_ATTR_KEY.SUPPORT_BUSINESS_ID]: finalBusinessId,
        },
        async () => {
          await supportChannelApi.create({
            id: finalBusinessId,
            name: form.name.trim(),
            description: form.description?.trim() || undefined,
            avatar: form.avatar?.trim() || undefined,
          });
        },
      );
      addToast('success', 'Support channel created');
      setCreating(false);
      setForm(DEFAULT_FORM);
      setPage(1);
      refresh();
    } catch (error: unknown) {
      addToast(
        'error',
        getErrorMessage(error, 'Create support channel failed'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const onAvatarFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setAvatarUploading(true);
    try {
      const token = await chatApi.getUploadToken(file.name, file.type);

      const uploadResp = await fetch(token.url, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type,
        },
        body: file,
      });

      if (!uploadResp.ok) {
        addToast('error', `Upload failed (${uploadResp.status})`);
        return;
      }

      const avatar = token.cdnUrl || token.key;
      setForm((p) => ({ ...p, avatar }));
      addToast('success', 'Avatar uploaded');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      addToast('error', message);
    } finally {
      event.target.value = '';
      setAvatarUploading(false);
    }
  };

  const onToggle = async (item: SupportChannelItem) => {
    try {
      await supportChannelApi.toggle(item.id, !item.isActive);
      addToast(
        'success',
        item.isActive
          ? 'Channel paused successfully'
          : 'Channel resumed successfully',
      );
      refresh();
    } catch (error: unknown) {
      addToast('error', getErrorMessage(error, 'Toggle channel status failed'));
    }
  };

  const onEdit = async (item: SupportChannelItem) => {
    const name = window.prompt('Support name', item.name ?? '');
    if (name === null) return;
    const description = window.prompt('Description', item.description ?? '');
    if (description === null) return;
    const avatar = window.prompt(
      'Avatar URL (optional)',
      item.botUser.avatar ?? '',
    );
    if (avatar === null) return;

    const payload: UpdateSupportChannelPayload = {
      name: name.trim(),
      description: description.trim() || undefined,
      avatar: avatar.trim() || undefined,
    };

    try {
      await supportChannelApi.update(item.id, payload);
      addToast('success', 'Support channel updated');
      refresh();
    } catch (error: unknown) {
      addToast(
        'error',
        getErrorMessage(error, 'Update support channel failed'),
      );
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Support Channels"
        description="Create and manage support bots/channels for /chat/business routing"
      />

      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-gray-900 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
            placeholder="Search by channel id / name"
            className="h-9 w-72 px-3 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm"
          />
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as FilterStatus);
              setPage(1);
            }}
            className="h-9 px-3 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm"
          >
            <option value="ALL">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Paused</option>
          </select>
          <button
            onClick={() => setCreating((v) => !v)}
            className="h-9 px-3 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm"
          >
            {creating ? 'Cancel' : '+ New Channel'}
          </button>
        </div>

        {creating && (
          <div className="grid md:grid-cols-4 gap-2 pt-2">
            <div className="flex gap-2 md:col-span-2">
              <select
                value={businessIdMode}
                onChange={(e) =>
                  setBusinessIdMode(e.target.value as BusinessIdMode)
                }
                className="h-9 px-3 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm"
              >
                <option value="builtin">Built-in Business ID</option>
                <option value="custom">Custom Business ID</option>
              </select>

              {businessIdMode === 'builtin' ? (
                <select
                  value={builtinBusinessId}
                  onChange={(e) => setBuiltinBusinessId(e.target.value)}
                  className="h-9 flex-1 px-3 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm"
                >
                  {BUILTIN_BUSINESS_IDS.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={form.id}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, id: e.target.value }))
                  }
                  placeholder="Custom businessId (e.g. my_support_v1)"
                  className="h-9 flex-1 px-3 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm"
                />
              )}
            </div>
            <input
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="Display name (English)"
              className="h-9 px-3 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm"
            />
            <input
              value={form.description ?? ''}
              onChange={(e) =>
                setForm((p) => ({ ...p, description: e.target.value }))
              }
              placeholder="Description"
              className="h-9 px-3 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm"
            />
            {form.avatar ? (
              <div className="flex items-center gap-2 h-9 px-1">
                <SmartImage
                  src={form.avatar}
                  alt="avatar preview"
                  className="h-8 w-8 rounded-full border border-gray-200 dark:border-white/10"
                  imgClassName="h-8 w-8 rounded-full object-cover"
                />
                <span className="text-xs text-gray-500 truncate max-w-[140px]">
                  Avatar uploaded
                </span>
                <button
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, avatar: '' }))}
                  className="text-xs text-red-500 hover:underline"
                >
                  Remove
                </button>
              </div>
            ) : (
              <input
                value={form.avatar ?? ''}
                onChange={(e) =>
                  setForm((p) => ({ ...p, avatar: e.target.value }))
                }
                placeholder="Avatar URL (optional)"
                className="h-9 px-3 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm"
              />
            )}
            <div className="md:col-span-4">
              <label className="mr-2 inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-gray-200 dark:border-white/10 text-sm cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onAvatarFileChange}
                />
                {avatarUploading ? 'Uploading...' : 'Upload Avatar'}
              </label>
              <button
                disabled={submitting}
                onClick={onCreate}
                className="h-9 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm"
              >
                {submitting ? 'Creating...' : 'Create Channel'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-gray-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-white/5">
              <tr className="text-left">
                <th className="px-4 py-3 font-medium">Channel ID</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Bot User ID</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-gray-500"
                  >
                    Loading...
                  </td>
                </tr>
              )}
              {!loading && list.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-gray-500"
                  >
                    No support channels
                  </td>
                </tr>
              )}
              {!loading &&
                list.map((item) => (
                  <tr
                    key={item.id}
                    className="border-t border-gray-100 dark:border-white/10"
                  >
                    <td className="px-4 py-3 font-mono">{item.id}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{item.name}</div>
                      {item.description && (
                        <div className="text-xs text-gray-500">
                          {item.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {item.botUserId}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                          item.isActive
                            ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300'
                            : 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300'
                        }`}
                      >
                        {item.isActive ? 'Active' : 'Paused'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onEdit(item)}
                          className="h-8 px-2 rounded-md border border-gray-200 dark:border-white/10 text-xs"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => onToggle(item)}
                          className="h-8 px-2 rounded-md border border-gray-200 dark:border-white/10 text-xs"
                        >
                          {item.isActive ? 'Pause' : 'Resume'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-gray-100 dark:border-white/10 flex items-center justify-between text-sm">
          <span className="text-gray-500">
            Total: {effectiveData?.total ?? 0}
          </span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-8 px-2 rounded-md border border-gray-200 dark:border-white/10 disabled:opacity-50"
            >
              Prev
            </button>
            <span>Page {page}</span>
            <button
              disabled={Boolean(
                effectiveData &&
                page * (effectiveData.pageSize || 20) >= effectiveData.total,
              )}
              onClick={() => setPage((p) => p + 1)}
              className="h-8 px-2 rounded-md border border-gray-200 dark:border-white/10 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
