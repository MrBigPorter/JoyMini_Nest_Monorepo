'use client';

import React, { useState } from 'react';
import { useRequest } from 'ahooks';
import {
  Megaphone,
  RefreshCw,
  Edit2,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Image as ImageIcon,
  Video,
  ChevronLeft,
  ChevronRight,
  X,
  Save,
} from 'lucide-react';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { adsApi } from '@/api';
import type {
  Advertisement,
  QueryAdsParams,
  CreateAdPayload,
} from '@/type/types';
import { format } from 'date-fns';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ModalManager } from '@repo/ui';

// ─── 位置标签 ─────────────────────────────────────────────────────────────────

const POSITION_LABELS: Record<number, string> = {
  1: 'Home Top',
  2: 'Home Mid',
  3: 'Category',
  4: 'Detail',
};

// ─── 表单 schema ──────────────────────────────────────────────────────────────

const adSchema = z.object({
  title: z.string(),
  fileType: z.number(),
  img: z.string(),
  videoUrl: z.string(),
  adPosition: z.number(),
  sortOrder: z.number(),
  jumpUrl: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  status: z.number(),
});

type AdFormValues = z.infer<typeof adSchema>;

// ─── Modal ────────────────────────────────────────────────────────────────────

function AdModal({
  ad,
  onClose,
  onSaved,
}: {
  ad: Advertisement | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!ad;
  const [saving, setSaving] = useState(false);

  const { register, handleSubmit } = useForm<AdFormValues>({
    defaultValues: {
      title: ad?.title ?? '',
      fileType: ad?.fileType ?? 1,
      img: ad?.img ?? '',
      videoUrl: ad?.videoUrl ?? '',
      adPosition: ad?.adPosition ?? 1,
      sortOrder: ad?.sortOrder ?? 0,
      jumpUrl: ad?.jumpUrl ?? '',
      startTime: ad?.startTime
        ? format(new Date(ad.startTime), "yyyy-MM-dd'T'HH:mm")
        : '',
      endTime: ad?.endTime
        ? format(new Date(ad.endTime), "yyyy-MM-dd'T'HH:mm")
        : '',
      status: ad?.status ?? 1,
    },
  });

  const onSubmit = async (values: AdFormValues) => {
    setSaving(true);
    try {
      const payload: CreateAdPayload = {
        title: values.title || undefined,
        fileType: values.fileType,
        img: values.img || undefined,
        videoUrl: values.videoUrl || undefined,
        adPosition: values.adPosition,
        sortOrder: values.sortOrder,
        jumpUrl: values.jumpUrl || undefined,
        startTime: values.startTime || undefined,
        endTime: values.endTime || undefined,
        status: values.status,
      };
      if (isEdit) {
        await adsApi.update(ad.id, payload);
      } else {
        await adsApi.create(payload);
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/10">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            {isEdit ? 'Edit Advertisement' : 'New Advertisement'}
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 flex flex-col gap-1">
              <label className="text-xs text-gray-500">Title</label>
              <input
                {...register('title')}
                className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">File Type</label>
              <select
                {...register('fileType', { valueAsNumber: true })}
                className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
              >
                <option value={1}>Image</option>
                <option value={2}>Video</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Position</label>
              <select
                {...register('adPosition', { valueAsNumber: true })}
                className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
              >
                {Object.entries(POSITION_LABELS).map(([v, l]) => (
                  <option key={v} value={Number(v)}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <label className="text-xs text-gray-500">Image URL</label>
              <input
                {...register('img')}
                placeholder="https://… or uploads/…"
                className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
              />
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <label className="text-xs text-gray-500">Video URL</label>
              <input
                {...register('videoUrl')}
                placeholder="https://…"
                className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
              />
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <label className="text-xs text-gray-500">Jump URL</label>
              <input
                {...register('jumpUrl')}
                placeholder="https://…"
                className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Start Time</label>
              <input
                type="datetime-local"
                {...register('startTime')}
                className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">End Time</label>
              <input
                type="datetime-local"
                {...register('endTime')}
                className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Sort Order</label>
              <input
                type="number"
                {...register('sortOrder', { valueAsNumber: true })}
                className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Status</label>
              <select
                {...register('status', { valueAsNumber: true })}
                className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
              >
                <option value={1}>Enabled</option>
                <option value={0}>Disabled</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-teal-500 hover:bg-teal-600 text-white rounded-xl disabled:opacity-50 transition-colors"
            >
              {saving ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <Save size={13} />
              )}
              {isEdit ? 'Save Changes' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export function AdsManagement() {
  const [queryParams, setQueryParams] = useState<QueryAdsParams>({
    page: 1,
    pageSize: 20,
  });
  const [modalAd, setModalAd] = useState<Advertisement | null | 'new'>(null);

  const {
    data,
    loading,
    run: refresh,
  } = useRequest(() => adsApi.getList(queryParams), {
    refreshDeps: [queryParams],
  });

  const ads = data?.list ?? [];
  const total = data?.total ?? 0;
  const page = queryParams.page ?? 1;
  const pageSize = queryParams.pageSize ?? 20;
  const totalPages = Math.ceil(total / pageSize);

  const handleToggle = async (ad: Advertisement) => {
    await adsApi.toggleStatus(ad.id);
    refresh();
  };

  const handleDelete = (ad: Advertisement) => {
    ModalManager.open({
      title: 'Delete Advertisement',
      content: `Delete "${ad.title ?? ad.id}"?`,
      confirmText: 'Delete',
      onConfirm: async () => {
        await adsApi.remove(ad.id);
        refresh();
      },
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Advertisements"
        description="Manage banner ads, video ads and promotional placements"
        buttonText="New Ad"
        buttonOnClick={() => setModalAd('new')}
      />

      {/* 筛选 */}
      <div className="flex items-center gap-3">
        <select
          value={queryParams.status ?? ''}
          onChange={(e) =>
            setQueryParams((p) => ({
              ...p,
              page: 1,
              status:
                e.target.value === '' ? undefined : Number(e.target.value),
            }))
          }
          className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-teal-500/50"
        >
          <option value="">All Status</option>
          <option value="1">Enabled</option>
          <option value="0">Disabled</option>
        </select>
        <select
          value={queryParams.adPosition ?? ''}
          onChange={(e) =>
            setQueryParams((p) => ({
              ...p,
              page: 1,
              adPosition:
                e.target.value === '' ? undefined : Number(e.target.value),
            }))
          }
          className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-teal-500/50"
        >
          <option value="">All Positions</option>
          {Object.entries(POSITION_LABELS).map(([v, l]) => (
            <option key={v} value={Number(v)}>
              {l}
            </option>
          ))}
        </select>
        <button
          onClick={() => refresh()}
          disabled={loading}
          className="p-2 rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* 表格 */}
      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-gray-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-white/10 bg-gray-50/50 dark:bg-white/3">
                {[
                  'Preview',
                  'Title',
                  'Position',
                  'Schedule',
                  'Stats',
                  'Status',
                  '',
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && ads.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-gray-400"
                  >
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && ads.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-gray-400"
                  >
                    <Megaphone size={32} className="mx-auto mb-2 opacity-30" />
                    No ads found
                  </td>
                </tr>
              )}
              {ads.map((ad) => (
                <tr
                  key={ad.id}
                  className="border-b border-gray-50 dark:border-white/5 hover:bg-gray-50/50 dark:hover:bg-white/3 transition-colors"
                >
                  {/* Preview */}
                  <td className="px-4 py-3">
                    <div className="w-14 h-10 rounded-lg overflow-hidden bg-gray-100 dark:bg-white/10 flex items-center justify-center flex-shrink-0">
                      {ad.img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={ad.img}
                          alt={ad.title ?? ''}
                          className="w-full h-full object-cover"
                        />
                      ) : ad.fileType === 2 ? (
                        <Video size={16} className="text-gray-400" />
                      ) : (
                        <ImageIcon size={16} className="text-gray-400" />
                      )}
                    </div>
                  </td>
                  {/* Title */}
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {ad.title ?? '(no title)'}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Sort #{ad.sortOrder}
                    </p>
                  </td>
                  {/* Position */}
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400">
                      {POSITION_LABELS[ad.adPosition] ?? `Pos ${ad.adPosition}`}
                    </span>
                  </td>
                  {/* Schedule */}
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                    {ad.startTime
                      ? format(new Date(ad.startTime), 'MM/dd HH:mm')
                      : '—'}
                    {' → '}
                    {ad.endTime
                      ? format(new Date(ad.endTime), 'MM/dd HH:mm')
                      : '∞'}
                  </td>
                  {/* Stats */}
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                    <div>👁 {ad.viewCount.toLocaleString()}</div>
                    <div>🖱 {ad.clickCount.toLocaleString()}</div>
                  </td>
                  {/* Status */}
                  <td className="px-4 py-3">
                    <button
                      onClick={() => void handleToggle(ad)}
                      className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full transition-colors ${
                        ad.status === 1
                          ? 'bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400'
                          : 'bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400'
                      }`}
                    >
                      {ad.status === 1 ? (
                        <ToggleRight size={13} />
                      ) : (
                        <ToggleLeft size={13} />
                      )}
                      {ad.status === 1 ? 'Enabled' : 'Disabled'}
                    </button>
                  </td>
                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setModalAd(ad)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-teal-500 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        onClick={() => void handleDelete(ad)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
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
                onClick={() =>
                  setQueryParams((p) => ({ ...p, page: page - 1 }))
                }
                className="p-1.5 rounded-lg bg-gray-100 dark:bg-white/5 disabled:opacity-40 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {page} / {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() =>
                  setQueryParams((p) => ({ ...p, page: page + 1 }))
                }
                className="p-1.5 rounded-lg bg-gray-100 dark:bg-white/5 disabled:opacity-40 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {modalAd !== null && (
        <AdModal
          ad={modalAd === 'new' ? null : modalAd}
          onClose={() => setModalAd(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
