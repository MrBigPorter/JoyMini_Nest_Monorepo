'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRequest } from 'ahooks';
import {
  ChevronRight,
  Edit2,
  Gift,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Trophy,
  X,
} from 'lucide-react';
import { format } from 'date-fns';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ModalManager } from '@repo/ui';
import { luckyDrawApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import type {
  CreateLuckyDrawActivityPayload,
  CreateLuckyDrawPrizePayload,
  LuckyDrawActivity,
  LuckyDrawPrize,
  LuckyDrawPrizeType,
  LuckyDrawResult,
  QueryLuckyDrawResultsParams,
} from '@/type/types';

const PRIZE_TYPE_LABELS: Record<LuckyDrawPrizeType, string> = {
  1: 'Coupon',
  2: 'Coins',
  3: 'Balance',
  4: 'No Prize',
};

const PRIZE_TYPE_COLORS: Record<LuckyDrawPrizeType, string> = {
  1: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  2: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  3: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  4: 'bg-gray-100 text-gray-500 dark:bg-gray-800/50 dark:text-gray-400',
};

const activitySchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required'),
    description: z.string(),
    treasureId: z.string(),
    status: z.number().int().min(0).max(1),
    startAt: z.string(),
    endAt: z.string(),
  })
  .superRefine((value, ctx) => {
    if (
      value.startAt &&
      value.endAt &&
      new Date(value.startAt) >= new Date(value.endAt)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endAt'],
        message: 'End time must be later than start time',
      });
    }
  });

type ActivityForm = z.infer<typeof activitySchema>;

const prizeSchema = z
  .object({
    prizeType: z.number().int().min(1).max(4),
    prizeName: z.string().trim().min(1, 'Prize name is required'),
    couponId: z.string(),
    prizeValue: z.string(),
    probability: z.string().trim().min(1, 'Probability is required'),
    stock: z.string(),
    sortOrder: z.string(),
  })
  .superRefine((value, ctx) => {
    const probability = Number(value.probability);

    if (Number.isNaN(probability) || probability < 0 || probability > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['probability'],
        message: 'Probability must be between 0 and 100',
      });
    }

    if (value.prizeType === 1 && !value.couponId.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['couponId'],
        message: 'Coupon ID is required for coupon prizes',
      });
    }

    if (
      (value.prizeType === 2 || value.prizeType === 3) &&
      !value.prizeValue.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['prizeValue'],
        message: 'Amount is required for coin/balance prizes',
      });
    }
  });

type PrizeForm = z.infer<typeof prizeSchema>;

const toLocalDateTimeValue = (value?: number | null) => {
  if (!value) return '';
  return format(new Date(value), "yyyy-MM-dd'T'HH:mm");
};

const formatDateTime = (value?: number | null) => {
  if (!value) return '—';
  return format(new Date(value), 'MM/dd HH:mm');
};

const shortId = (value?: string | null) => {
  if (!value) return '—';
  return value.length > 8 ? `${value.slice(0, 8)}…` : value;
};

const formatActivityCount = (count: number) =>
  `${count} ${count === 1 ? 'activity' : 'activities'}`;

function ActivityModal({
  activity,
  onClose,
  onSaved,
}: {
  activity: LuckyDrawActivity | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(activity);
  const [saving, setSaving] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ActivityForm>({
    resolver: zodResolver(activitySchema),
    defaultValues: {
      title: activity?.title ?? '',
      description: activity?.description ?? '',
      treasureId: activity?.treasureId ?? '',
      status: activity?.status ?? 1,
      startAt: toLocalDateTimeValue(activity?.startAt),
      endAt: toLocalDateTimeValue(activity?.endAt),
    },
  });

  const onSubmit = async (values: ActivityForm) => {
    setSaving(true);

    try {
      const payload: CreateLuckyDrawActivityPayload = {
        title: values.title.trim(),
        description: values.description.trim() || undefined,
        treasureId: values.treasureId.trim() || undefined,
        status: values.status,
        startAt: values.startAt || undefined,
        endAt: values.endAt || undefined,
      };

      if (activity) {
        await luckyDrawApi.updateActivity(activity.id, payload);
      } else {
        await luckyDrawApi.createActivity(payload);
      }

      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-white/10">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            {isEdit ? 'Edit Activity' : 'New Activity'}
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/5 dark:hover:text-gray-200"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 p-5">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Title *</label>
            <input
              {...register('title')}
              placeholder="e.g. Spring Lucky Draw"
              className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
            {errors.title && (
              <p className="text-xs text-red-500">{errors.title.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Description</label>
            <textarea
              {...register('description')}
              rows={3}
              className="resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">
              Treasure ID{' '}
              <span className="text-gray-400">(optional, empty = all)</span>
            </label>
            <input
              {...register('treasureId')}
              placeholder="treasure_xxx"
              className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Start Time</label>
              <input
                type="datetime-local"
                {...register('startAt')}
                className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-white/5 dark:text-white"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">End Time</label>
              <input
                type="datetime-local"
                {...register('endAt')}
                className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-white/5 dark:text-white"
              />
              {errors.endAt && (
                <p className="text-xs text-red-500">{errors.endAt.message}</p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Status</label>
            <select
              {...register('status', { valueAsNumber: true })}
              className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-white/5 dark:text-white"
            >
              <option value={1}>Active</option>
              <option value={0}>Inactive</option>
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-teal-500 px-4 py-2 text-sm text-white transition-colors hover:bg-teal-600 disabled:opacity-50"
            >
              {saving ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <Save size={13} />
              )}
              {isEdit ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PrizeModal({
  activityId,
  prize,
  onClose,
  onSaved,
}: {
  activityId: string;
  prize: LuckyDrawPrize | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<PrizeForm>({
    resolver: zodResolver(prizeSchema),
    defaultValues: {
      prizeType: prize?.prizeType ?? 4,
      prizeName: prize?.prizeName ?? '',
      couponId: prize?.couponId ?? '',
      prizeValue: prize?.prizeValue != null ? String(prize.prizeValue) : '',
      probability: prize?.probability != null ? String(prize.probability) : '',
      stock: prize?.stock != null ? String(prize.stock) : '-1',
      sortOrder: prize?.sortOrder != null ? String(prize.sortOrder) : '0',
    },
  });

  const prizeType = watch('prizeType');

  const onSubmit = async (values: PrizeForm) => {
    setSaving(true);

    try {
      const payload: CreateLuckyDrawPrizePayload = {
        activityId,
        prizeType: values.prizeType as LuckyDrawPrizeType,
        prizeName: values.prizeName.trim(),
        couponId: values.couponId.trim() || undefined,
        prizeValue: values.prizeValue.trim()
          ? Number(values.prizeValue)
          : undefined,
        probability: Number(values.probability),
        stock: values.stock.trim() ? Number(values.stock) : -1,
        sortOrder: values.sortOrder.trim() ? Number(values.sortOrder) : 0,
      };

      if (prize) {
        await luckyDrawApi.updatePrize(prize.id, payload);
      } else {
        await luckyDrawApi.createPrize(payload);
      }

      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-white/10">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            {prize ? 'Edit Prize' : 'Add Prize'}
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/5 dark:hover:text-gray-200"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 p-5">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Prize Type *</label>
            <select
              {...register('prizeType', { valueAsNumber: true })}
              className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-white/5 dark:text-white"
            >
              <option value={1}>Coupon</option>
              <option value={2}>Coins</option>
              <option value={3}>Balance</option>
              <option value={4}>No Prize</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Prize Name *</label>
            <input
              {...register('prizeName')}
              placeholder="e.g. $5 Coupon"
              className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
            {errors.prizeName && (
              <p className="text-xs text-red-500">{errors.prizeName.message}</p>
            )}
          </div>

          {prizeType === 1 && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Coupon ID *</label>
              <input
                {...register('couponId')}
                placeholder="coupon_xxx"
                className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-white/5 dark:text-white"
              />
              {errors.couponId && (
                <p className="text-xs text-red-500">
                  {errors.couponId.message}
                </p>
              )}
            </div>
          )}

          {(prizeType === 2 || prizeType === 3) && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Amount *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                {...register('prizeValue')}
                className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-white/5 dark:text-white"
              />
              {errors.prizeValue && (
                <p className="text-xs text-red-500">
                  {errors.prizeValue.message}
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Probability *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                {...register('probability')}
                className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-white/5 dark:text-white"
              />
              {errors.probability && (
                <p className="text-xs text-red-500">
                  {errors.probability.message}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Stock</label>
              <input
                type="number"
                min="-1"
                {...register('stock')}
                className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-white/5 dark:text-white"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Sort Order</label>
            <input
              type="number"
              min="0"
              {...register('sortOrder')}
              className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-teal-500 px-4 py-2 text-sm text-white transition-colors hover:bg-teal-600 disabled:opacity-50"
            >
              {saving ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <Save size={13} />
              )}
              {prize ? 'Save' : 'Add Prize'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PrizesPanel({
  activity,
  onChanged,
}: {
  activity: LuckyDrawActivity;
  onChanged: () => void;
}) {
  const [prizeModal, setPrizeModal] = useState<LuckyDrawPrize | null | false>(
    false,
  );

  const { data, loading, refresh } = useRequest(
    () => luckyDrawApi.listPrizes(activity.id),
    {
      refreshDeps: [activity.id],
    },
  );

  const prizes = data?.list ?? [];
  const totalProbability = prizes.reduce(
    (sum, item) => sum + Number(item.probability ?? 0),
    0,
  );

  const handleRefresh = async () => {
    await refresh();
    onChanged();
  };

  const handleDelete = (prizeId: string) => {
    ModalManager.open({
      title: 'Delete Prize',
      content: 'Delete this prize?',
      confirmText: 'Delete',
      onConfirm: async () => {
        await luckyDrawApi.deletePrize(prizeId);
        await handleRefresh();
      },
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {activity.title}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Prize pool total:{' '}
            <span
              className={
                totalProbability === 100
                  ? 'font-medium text-green-500'
                  : 'font-medium text-orange-500'
              }
            >
              {totalProbability}%
            </span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleRefresh()}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/5 dark:hover:text-gray-300"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setPrizeModal(null)}
            className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-3 py-1.5 text-xs text-white transition-colors hover:bg-teal-600"
          >
            <Plus size={13} />
            Add Prize
          </button>
        </div>
      </div>

      {loading && prizes.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <RefreshCw size={18} className="mr-2 animate-spin" />
          Loading…
        </div>
      ) : prizes.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-gray-400">
          <Gift size={32} className="opacity-30" />
          <p className="text-sm">No prizes configured yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {prizes.map((item) => (
            <div
              key={item.id}
              className="group flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-white/8 dark:bg-white/3"
            >
              <div className="min-w-0 flex items-center gap-3">
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${PRIZE_TYPE_COLORS[item.prizeType]}`}
                >
                  {PRIZE_TYPE_LABELS[item.prizeType]}
                </span>

                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                    {item.prizeName}
                  </p>
                  <p className="text-xs text-gray-400">
                    {item.probability}% probability ·{' '}
                    {item.stock === -1 ? '∞ stock' : `${item.stock} left`}
                    {item.prizeValue != null &&
                      ` · ${item.prizeType === 2 ? `${item.prizeValue} coins` : item.prizeType === 3 ? `$${item.prizeValue}` : item.prizeValue}`}
                    {item.couponName && ` · ${item.couponName}`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => setPrizeModal(item)}
                  className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-teal-50 hover:text-teal-500 dark:hover:bg-teal-900/20"
                >
                  <Edit2 size={13} />
                </button>
                <button
                  onClick={() => void handleDelete(item.id)}
                  className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {prizeModal !== false && (
        <PrizeModal
          activityId={activity.id}
          prize={prizeModal}
          onClose={() => setPrizeModal(false)}
          onSaved={() => void handleRefresh()}
        />
      )}
    </div>
  );
}

function ResultsPanel({ activities }: { activities: LuckyDrawActivity[] }) {
  const [params, setParams] = useState<QueryLuckyDrawResultsParams>({
    activityId: activities[0]?.id,
    page: 1,
    pageSize: 20,
  });

  useEffect(() => {
    const currentExists = activities.some(
      (item) => item.id === params.activityId,
    );

    if (!activities.length) {
      if (params.activityId !== undefined) {
        setParams((prev) => ({
          ...prev,
          activityId: undefined,
          page: 1,
        }));
      }
      return;
    }

    if (!currentExists) {
      setParams((prev) => ({
        ...prev,
        activityId: activities[0].id,
        page: 1,
      }));
    }
  }, [activities, params.activityId]);

  const { data, loading, refresh } = useRequest(
    () => luckyDrawApi.listResults(params),
    {
      ready: Boolean(params.activityId),
      refreshDeps: [params],
    },
  );

  const results: LuckyDrawResult[] = data?.list ?? [];
  const total = data?.total ?? 0;
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 dark:border-white/10 dark:bg-gray-900/50">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            Draw Results{' '}
            <span className="font-normal text-gray-400">({total})</span>
          </h3>
          <p className="mt-1 text-xs text-gray-400">
            Results are currently queried per activity to match the backend
            contract.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={params.activityId ?? ''}
            onChange={(e) =>
              setParams((prev) => ({
                ...prev,
                activityId: e.target.value || undefined,
                page: 1,
              }))
            }
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-gray-900 dark:text-gray-300"
          >
            {activities.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>

          <button
            onClick={refresh}
            disabled={!params.activityId}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-white/5 dark:hover:text-gray-300"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {!params.activityId ? (
        <div className="py-12 text-center text-sm text-gray-400">
          Create an activity first to view results.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase text-gray-400 dark:border-white/8">
                  <th className="pb-2 font-medium">Time</th>
                  <th className="pb-2 font-medium">User</th>
                  <th className="pb-2 font-medium">Prize</th>
                  <th className="pb-2 font-medium">Coupon</th>
                  <th className="pb-2 font-medium">Order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                {results.map((item) => (
                  <tr key={item.id}>
                    <td className="py-2.5 text-xs text-gray-400">
                      {formatDateTime(item.createdAt)}
                    </td>
                    <td className="py-2.5 text-xs text-gray-700 dark:text-gray-300">
                      {item.userNickname ?? shortId(item.userId)}
                    </td>
                    <td className="py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${PRIZE_TYPE_COLORS[item.prizeType]}`}
                      >
                        {item.prizeName}
                      </span>
                    </td>
                    <td className="py-2.5 text-xs text-gray-500 dark:text-gray-400">
                      {item.couponName ?? '—'}
                    </td>
                    <td className="py-2.5 font-mono text-xs text-gray-400">
                      {shortId(item.orderId)}
                    </td>
                  </tr>
                ))}
                {!loading && results.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-8 text-center text-sm text-gray-400"
                    >
                      No draw results yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {total > pageSize && (
            <div className="mt-4 flex justify-center gap-2">
              <button
                disabled={page === 1}
                onClick={() =>
                  setParams((prev) => ({
                    ...prev,
                    page: (prev.page ?? 1) - 1,
                  }))
                }
                className="rounded-lg border border-gray-200 px-3 py-1 text-xs transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
              >
                Prev
              </button>
              <span className="px-3 py-1 text-xs text-gray-500">
                {page} / {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() =>
                  setParams((prev) => ({
                    ...prev,
                    page: (prev.page ?? 1) + 1,
                  }))
                }
                className="rounded-lg border border-gray-200 px-3 py-1 text-xs transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

type Tab = 'activities' | 'results';

export function LuckyDrawManagement() {
  const [tab, setTab] = useState<Tab>('activities');
  const [activityModal, setActivityModal] = useState<
    LuckyDrawActivity | null | false
  >(false);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(
    null,
  );

  const { data, loading, refresh } = useRequest(
    () => luckyDrawApi.listActivities({ page: 1, pageSize: 100 }),
    {},
  );

  const activities = useMemo(() => data?.list ?? [], [data?.list]);
  const selectedActivity =
    activities.find((item) => item.id === selectedActivityId) ?? null;

  useEffect(() => {
    if (!activities.length) {
      if (selectedActivityId !== null) {
        setSelectedActivityId(null);
      }
      return;
    }

    const exists = activities.some((item) => item.id === selectedActivityId);
    if (!exists) {
      setSelectedActivityId(activities[0].id);
    }
  }, [activities, selectedActivityId]);

  const handleDeleteActivity = (activityId: string) => {
    ModalManager.open({
      title: 'Delete Activity',
      content: 'Delete this activity and all its prizes?',
      confirmText: 'Delete',
      onConfirm: async () => {
        await luckyDrawApi.deleteActivity(activityId);
        await refresh();
      },
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Lucky Draw"
        description="Manage lucky draw activities, prize pools and draw results"
        buttonText="New Activity"
        buttonOnClick={() => setActivityModal(null)}
        buttonPrefixIcon={<Plus size={16} />}
      />

      <div className="w-fit rounded-xl bg-gray-100 p-1 dark:bg-white/5">
        <div className="flex gap-1">
          {(['activities', 'results'] as Tab[]).map((item) => (
            <button
              key={item}
              onClick={() => setTab(item)}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === item
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-white'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              <span className="flex items-center gap-1.5">
                {item === 'activities' ? (
                  <Gift size={13} />
                ) : (
                  <Trophy size={13} />
                )}
                {item === 'activities' ? 'Activities' : 'Results'}
              </span>
            </button>
          ))}
        </div>
      </div>

      {tab === 'results' ? (
        <ResultsPanel activities={activities} />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
          <section className="rounded-2xl border border-gray-100 bg-white p-5 dark:border-white/10 dark:bg-gray-900/50">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-gray-500">
                {formatActivityCount(activities.length)}
              </p>

              <button
                onClick={refresh}
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/5 dark:hover:text-gray-300"
              >
                <RefreshCw
                  size={14}
                  className={loading ? 'animate-spin' : ''}
                />
              </button>
            </div>

            {loading && activities.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-gray-400">
                <RefreshCw size={18} className="mr-2 animate-spin" />
                Loading…
              </div>
            ) : activities.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-gray-400">
                <Sparkles size={32} className="opacity-30" />
                <p className="text-sm">No activities yet</p>
                <button
                  onClick={() => setActivityModal(null)}
                  className="mt-2 rounded-xl bg-teal-500 px-4 py-2 text-sm text-white transition-colors hover:bg-teal-600"
                >
                  Create First Activity
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {activities.map((activity) => {
                  const isSelected = activity.id === selectedActivityId;
                  const prizeCount =
                    activity.prizesCount ?? activity.prizes?.length ?? 0;

                  return (
                    <div
                      key={activity.id}
                      onClick={() => setSelectedActivityId(activity.id)}
                      className={`group cursor-pointer rounded-2xl border p-4 transition-all ${
                        isSelected
                          ? 'border-teal-200 bg-teal-50/70 ring-2 ring-teal-500/30 dark:border-teal-800 dark:bg-teal-950/20'
                          : 'border-gray-100 bg-white hover:shadow-sm dark:border-white/8 dark:bg-gray-900/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 pr-2">
                          <div className="mb-2 flex items-center gap-2">
                            <Sparkles
                              size={15}
                              className="shrink-0 text-teal-500"
                            />
                            <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                              {activity.title}
                            </p>
                          </div>

                          {activity.description && (
                            <p className="mb-3 line-clamp-2 text-xs text-gray-400">
                              {activity.description}
                            </p>
                          )}

                          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                            <span>{prizeCount} prizes</span>
                            <span>· {activity.ticketsCount ?? 0} tickets</span>
                            {activity.treasureName && (
                              <span className="truncate">
                                · {activity.treasureName}
                              </span>
                            )}
                            <span>· {formatDateTime(activity.startAt)}</span>
                          </div>
                        </div>

                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            activity.status === 1
                              ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'
                          }`}
                        >
                          {activity.status === 1 ? 'Active' : 'Inactive'}
                        </span>
                      </div>

                      <div
                        className="mt-3 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <button
                          onClick={() => setSelectedActivityId(activity.id)}
                          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-teal-600 transition-colors hover:bg-teal-50 dark:hover:bg-teal-900/20"
                        >
                          <ChevronRight size={12} />
                          Prizes
                        </button>
                        <button
                          onClick={() => setActivityModal(activity)}
                          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-teal-50 hover:text-teal-500 dark:hover:bg-teal-900/20"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={() => void handleDeleteActivity(activity.id)}
                          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <aside className="rounded-2xl border border-gray-100 bg-white p-5 dark:border-white/10 dark:bg-gray-900/50">
            {selectedActivity ? (
              <PrizesPanel activity={selectedActivity} onChanged={refresh} />
            ) : (
              <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 text-gray-400">
                <Gift size={32} className="opacity-30" />
                <p className="text-sm">
                  Select an activity to manage its prize pool
                </p>
              </div>
            )}
          </aside>
        </div>
      )}

      {activityModal !== false && (
        <ActivityModal
          activity={activityModal}
          onClose={() => setActivityModal(false)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
