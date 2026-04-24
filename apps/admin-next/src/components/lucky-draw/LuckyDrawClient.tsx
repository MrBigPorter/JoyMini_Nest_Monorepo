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
import { useTranslation } from '@/hooks/useTranslation';
import type { TFunc } from '@/hooks/useTranslation';
import type {
  CreateLuckyDrawActivityPayload,
  CreateLuckyDrawPrizePayload,
  LuckyDrawActivity,
  LuckyDrawPrize,
  LuckyDrawPrizeType,
  LuckyDrawResult,
  QueryLuckyDrawResultsParams,
} from '@/type/types';

const PRIZE_TYPE_COLORS: Record<LuckyDrawPrizeType, string> = {
  1: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
  2: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  3: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400',
  4: 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',
};

const toLocalDateTimeValue = (value?: number | null) => {
  if (!value) return '';
  const d = new Date(value);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
};

const formatDateTime = (value?: number | null) => {
  if (!value) return '—';
  return format(new Date(value), 'yyyy-MM-dd HH:mm');
};

const shortId = (value?: string | null) => {
  if (!value) return '—';
  return value.length > 10 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
};

function ActivityModal({
  activity,
  onClose,
  onSaved,
  t,
}: {
  activity: LuckyDrawActivity | null;
  onClose: () => void;
  onSaved: () => void;
  t: TFunc;
}) {
  const isEdit = activity !== null;

  const activitySchema = useMemo(
    () =>
      z
        .object({
          title: z.string().min(1, t('luckyDraw.titleIsRequired')),
          description: z.string().optional(),
          treasureId: z.string().optional(),
          startAt: z.string().min(1),
          endAt: z.string().min(1),
          status: z.number(),
        })
        .superRefine((value, ctx) => {
          if (value.startAt && value.endAt) {
            const start = new Date(value.startAt).getTime();
            const end = new Date(value.endAt).getTime();
            if (end <= start) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: t('luckyDraw.endTimeAfterStart'),
                path: ['endAt'],
              });
            }
          }
        }),
    [t],
  );

  type ActivityForm = z.infer<typeof activitySchema>;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ActivityForm>({
    resolver: zodResolver(activitySchema),
    defaultValues: {
      title: '',
      description: '',
      treasureId: '',
      startAt: '',
      endAt: '',
      status: 1,
    },
  });

  useEffect(() => {
    if (activity) {
      reset({
        title: activity.title,
        description: activity.description ?? '',
        treasureId: activity.treasureId ?? '',
        startAt: toLocalDateTimeValue(activity.startAt),
        endAt: toLocalDateTimeValue(activity.endAt),
        status: activity.status,
      });
    } else {
      reset({
        title: '',
        description: '',
        treasureId: '',
        startAt: '',
        endAt: '',
        status: 1,
      });
    }
  }, [activity, reset]);

  const { run: doSave, loading: saving } = useRequest(
    async (values: ActivityForm) => {
      const payload: CreateLuckyDrawActivityPayload = {
        title: values.title,
        description: values.description || undefined,
        treasureId: values.treasureId || undefined,
        startAt: values.startAt || undefined,
        endAt: values.endAt || undefined,
        status: values.status,
      };
      if (isEdit) {
        await luckyDrawApi.updateActivity(activity.id, payload);
      } else {
        await luckyDrawApi.createActivity(payload);
      }
    },
    {
      manual: true,
      onSuccess: () => {
        onSaved();
        onClose();
      },
    },
  );

  const onSubmit = async (values: ActivityForm) => {
    await doSave(values);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {isEdit ? t('luckyDraw.editActivity') : t('luckyDraw.newActivity')}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/5"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">
              {t('luckyDraw.titleRequired')}
            </label>
            <input
              {...register('title')}
              placeholder={t('luckyDraw.titlePlaceholder')}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-gray-800 dark:text-gray-200"
            />
            {errors.title && (
              <p className="text-xs text-red-500">{errors.title.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">
              {t('luckyDraw.description')}
            </label>
            <textarea
              {...register('description')}
              rows={3}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-gray-800 dark:text-gray-200"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">
              {t('luckyDraw.treasureId')}
            </label>
            <input
              {...register('treasureId')}
              placeholder={t('luckyDraw.treasureIdPlaceholder')}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-gray-800 dark:text-gray-200"
            />
            <p className="text-[10px] text-gray-400">
              {t('luckyDraw.treasureIdHint')}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">
                {t('luckyDraw.startTime')}
              </label>
              <input
                type="datetime-local"
                {...register('startAt')}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-gray-800 dark:text-gray-200"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">
                {t('luckyDraw.endTime')}
              </label>
              <input
                type="datetime-local"
                {...register('endAt')}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-gray-800 dark:text-gray-200"
              />
              {errors.endAt && (
                <p className="text-xs text-red-500">{errors.endAt.message}</p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">
              {t('luckyDraw.status')}
            </label>
            <select
              {...register('status', { valueAsNumber: true })}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-gray-800 dark:text-gray-200"
            >
              <option value={1}>{t('luckyDraw.active')}</option>
              <option value={0}>{t('luckyDraw.inactive')}</option>
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5"
            >
              {t('luckyDraw.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-4 py-2 text-sm text-white transition-colors hover:bg-teal-600 disabled:opacity-50"
            >
              <Save size={14} />
              {isEdit ? t('luckyDraw.save') : t('luckyDraw.create')}
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
  t,
}: {
  activityId: string;
  prize: LuckyDrawPrize | null;
  onClose: () => void;
  onSaved: () => void;
  t: TFunc;
}) {
  const isEdit = prize !== null;

  const prizeSchema = useMemo(
    () =>
      z
        .object({
          prizeType: z.number(),
          prizeName: z.string().min(1, t('luckyDraw.prizeNameIsRequired')),
          couponId: z.string().optional(),
          amount: z.number().optional(),
          probability: z
            .number()
            .min(0, t('luckyDraw.probabilityRange'))
            .max(100, t('luckyDraw.probabilityRange')),
          stock: z.number().optional(),
          sortOrder: z.number().optional(),
        })
        .superRefine((value, ctx) => {
          if (value.prizeType === 1 && !value.couponId) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: t('luckyDraw.couponIdForCoupon'),
              path: ['couponId'],
            });
          }
          if (
            (value.prizeType === 2 || value.prizeType === 3) &&
            (value.amount == null || value.amount <= 0)
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: t('luckyDraw.amountForCoinBalance'),
              path: ['amount'],
            });
          }
        }),
    [t],
  );

  type PrizeForm = z.infer<typeof prizeSchema>;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<PrizeForm>({
    resolver: zodResolver(prizeSchema),
    defaultValues: {
      prizeType: 1,
      prizeName: '',
      couponId: '',
      amount: undefined,
      probability: 0,
      stock: -1,
      sortOrder: 0,
    },
  });

  const prizeType = watch('prizeType');

  useEffect(() => {
    if (prize) {
      reset({
        prizeType: prize.prizeType,
        prizeName: prize.prizeName,
        couponId: prize.couponId ?? '',
        amount: prize.prizeValue ?? undefined,
        probability: prize.probability,
        stock: prize.stock,
        sortOrder: prize.sortOrder ?? 0,
      });
    } else {
      reset({
        prizeType: 1,
        prizeName: '',
        couponId: '',
        amount: undefined,
        probability: 0,
        stock: -1,
        sortOrder: 0,
      });
    }
  }, [prize, reset]);

  const { run: doSave, loading: saving } = useRequest(
    async (values: PrizeForm) => {
      const payload: CreateLuckyDrawPrizePayload = {
        activityId,
        prizeType: values.prizeType as LuckyDrawPrizeType,
        prizeName: values.prizeName,
        couponId:
          values.prizeType === 1 ? values.couponId || undefined : undefined,
        prizeValue:
          values.prizeType === 2 || values.prizeType === 3
            ? values.amount
            : undefined,
        probability: values.probability,
        stock: values.stock ?? -1,
        sortOrder: values.sortOrder ?? 0,
      };
      if (isEdit) {
        await luckyDrawApi.updatePrize(prize.id, payload);
      } else {
        await luckyDrawApi.createPrize(payload);
      }
    },
    {
      manual: true,
      onSuccess: () => {
        onSaved();
        onClose();
      },
    },
  );

  const onSubmit = async (values: PrizeForm) => {
    await doSave(values);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {isEdit ? t('luckyDraw.editPrize') : t('luckyDraw.addPrize')}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/5"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">
              {t('luckyDraw.prizeTypeRequired')}
            </label>
            <select
              {...register('prizeType', { valueAsNumber: true })}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-gray-800 dark:text-gray-200"
            >
              <option value={1}>{t('luckyDraw.prizeTypeCoupon')}</option>
              <option value={2}>{t('luckyDraw.prizeTypeCoins')}</option>
              <option value={3}>{t('luckyDraw.prizeTypeBalance')}</option>
              <option value={4}>{t('luckyDraw.prizeTypeNoPrize')}</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">
              {t('luckyDraw.prizeNameRequired')}
            </label>
            <input
              {...register('prizeName')}
              placeholder={t('luckyDraw.prizeNamePlaceholder')}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-gray-800 dark:text-gray-200"
            />
            {errors.prizeName && (
              <p className="text-xs text-red-500">{errors.prizeName.message}</p>
            )}
          </div>

          {prizeType === 1 && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">
                {t('luckyDraw.couponIdRequired')}
              </label>
              <input
                {...register('couponId')}
                placeholder={t('luckyDraw.couponIdPlaceholder')}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-gray-800 dark:text-gray-200"
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
              <label className="text-xs text-gray-500">
                {t('luckyDraw.amountRequired')}
              </label>
              <input
                type="number"
                step="any"
                {...register('amount', { valueAsNumber: true })}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-gray-800 dark:text-gray-200"
              />
              {errors.amount && (
                <p className="text-xs text-red-500">{errors.amount.message}</p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">
              {t('luckyDraw.probabilityRequired')}
            </label>
            <input
              type="number"
              step="any"
              {...register('probability', { valueAsNumber: true })}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-gray-800 dark:text-gray-200"
            />
            {errors.probability && (
              <p className="text-xs text-red-500">
                {errors.probability.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">
              {t('luckyDraw.stock')}
            </label>
            <input
              type="number"
              {...register('stock', { valueAsNumber: true })}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-gray-800 dark:text-gray-200"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">
              {t('luckyDraw.sortOrder')}
            </label>
            <input
              type="number"
              {...register('sortOrder', { valueAsNumber: true })}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50 dark:border-white/10 dark:bg-gray-800 dark:text-gray-200"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5"
            >
              {t('luckyDraw.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-4 py-2 text-sm text-white transition-colors hover:bg-teal-600 disabled:opacity-50"
            >
              <Save size={14} />
              {isEdit ? t('luckyDraw.save') : t('luckyDraw.addPrize')}
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
  t,
}: {
  activity: LuckyDrawActivity;
  onChanged: () => void;
  t: TFunc;
}) {
  const [prizes, setPrizes] = useState<LuckyDrawPrize[]>([]);
  const [loading, setLoading] = useState(true);
  const [prizeModal, setPrizeModal] = useState<LuckyDrawPrize | null | false>(
    false,
  );

  const handleRefresh = async () => {
    setLoading(true);
    try {
      const res = await luckyDrawApi.listPrizes(activity.id);
      setPrizes(res.list ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void handleRefresh();
  }, [activity.id, handleRefresh]);

  const handleDelete = (prizeId: string) => {
    ModalManager.open({
      title: t('luckyDraw.deletePrize'),
      content: t('luckyDraw.deletePrizeConfirm'),
      confirmText: t('luckyDraw.delete'),
      onConfirm: async () => {
        await luckyDrawApi.deletePrize(prizeId);
        await handleRefresh();
        onChanged();
      },
    });
  };

  const totalProbability = useMemo(
    () => prizes.reduce((sum, p) => sum + p.probability, 0),
    [prizes],
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          {t('luckyDraw.prizes')}
        </h3>
        <button
          onClick={() => setPrizeModal(null)}
          className="flex items-center gap-1 rounded-lg bg-teal-500 px-3 py-1.5 text-xs text-white transition-colors hover:bg-teal-600"
        >
          <Plus size={12} />
          {t('luckyDraw.addPrize')}
        </button>
      </div>

      {loading && prizes.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-sm text-gray-400">
          {t('luckyDraw.loading')}
        </div>
      ) : prizes.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-gray-400">
          <Gift size={28} className="opacity-30" />
          <p className="text-sm">{t('luckyDraw.noPrizes')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {prizes.map((item) => (
            <div
              key={item.id}
              className="group flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50/50 p-3 transition-colors hover:border-gray-200 dark:border-white/5 dark:bg-white/3 dark:hover:border-white/10"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${PRIZE_TYPE_COLORS[item.prizeType]}`}
                >
                  {item.prizeType === 1
                    ? t('luckyDraw.prizeTypeCoupon')
                    : item.prizeType === 2
                      ? t('luckyDraw.prizeTypeCoins')
                      : item.prizeType === 3
                        ? t('luckyDraw.prizeTypeBalance')
                        : t('luckyDraw.prizeTypeNoPrize')}
                </span>

                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                    {item.prizeName}
                  </p>
                  <p className="text-xs text-gray-400">
                    {item.probability}% {t('luckyDraw.probabilityLabel')} ·{' '}
                    {item.stock === -1
                      ? t('luckyDraw.unlimitedStock')
                      : t('luckyDraw.stockLeft', { stock: item.stock })}
                    {item.prizeValue != null &&
                      ` · ${
                        item.prizeType === 2
                          ? t('luckyDraw.coinsValue', {
                              value: item.prizeValue,
                            })
                          : item.prizeType === 3
                            ? t('luckyDraw.balanceValue', {
                                value: item.prizeValue,
                              })
                            : item.prizeValue
                      }`}
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

          <p className="pt-2 text-right text-xs text-gray-400">
            {t('luckyDraw.prizePoolTotal')} {totalProbability}%
          </p>
        </div>
      )}

      {prizeModal !== false && (
        <PrizeModal
          activityId={activity.id}
          prize={prizeModal}
          onClose={() => setPrizeModal(false)}
          onSaved={() => void handleRefresh()}
          t={t}
        />
      )}
    </div>
  );
}

function ResultsPanel({
  activities,
  t,
}: {
  activities: LuckyDrawActivity[];
  t: TFunc;
}) {
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
            {t('luckyDraw.drawResults')}{' '}
            <span className="font-normal text-gray-400">({total})</span>
          </h3>
          <p className="mt-1 text-xs text-gray-400">
            {t('luckyDraw.resultsHint')}
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
          {t('luckyDraw.createActivityFirst')}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase text-gray-400 dark:border-white/8">
                  <th className="pb-2 font-medium">{t('luckyDraw.time')}</th>
                  <th className="pb-2 font-medium">{t('luckyDraw.user')}</th>
                  <th className="pb-2 font-medium">{t('luckyDraw.prize')}</th>
                  <th className="pb-2 font-medium">{t('luckyDraw.coupon')}</th>
                  <th className="pb-2 font-medium">{t('luckyDraw.order')}</th>
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
                      {t('luckyDraw.noResults')}
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
                {t('luckyDraw.prev')}
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
                {t('luckyDraw.next')}
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
  const { t } = useTranslation();
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
      title: t('luckyDraw.deleteActivity'),
      content: t('luckyDraw.deleteActivityConfirm'),
      confirmText: t('luckyDraw.delete'),
      onConfirm: async () => {
        await luckyDrawApi.deleteActivity(activityId);
        await refresh();
      },
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('luckyDraw.pageTitle')}
        description={t('luckyDraw.pageDescription')}
        buttonText={t('luckyDraw.newActivity')}
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
                {item === 'activities'
                  ? t('luckyDraw.activitiesTab')
                  : t('luckyDraw.resultsTab')}
              </span>
            </button>
          ))}
        </div>
      </div>

      {tab === 'results' ? (
        <ResultsPanel activities={activities} t={t} />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
          <section className="rounded-2xl border border-gray-100 bg-white p-5 dark:border-white/10 dark:bg-gray-900/50">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-gray-500">
                {t('luckyDraw.activityCount', { count: activities.length })}
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
                {t('luckyDraw.loading')}
              </div>
            ) : activities.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-gray-400">
                <Sparkles size={32} className="opacity-30" />
                <p className="text-sm">{t('luckyDraw.noActivities')}</p>
                <button
                  onClick={() => setActivityModal(null)}
                  className="mt-2 rounded-xl bg-teal-500 px-4 py-2 text-sm text-white transition-colors hover:bg-teal-600"
                >
                  {t('luckyDraw.createFirstActivity')}
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
                            <span>
                              {t('luckyDraw.prizeCount', {
                                count: prizeCount,
                              })}
                            </span>
                            <span>
                              ·{' '}
                              {t('luckyDraw.ticketCount', {
                                count: activity.ticketsCount ?? 0,
                              })}
                            </span>
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
                          {activity.status === 1
                            ? t('luckyDraw.active')
                            : t('luckyDraw.inactive')}
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
                          {t('luckyDraw.prizes')}
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
              <PrizesPanel
                activity={selectedActivity}
                onChanged={refresh}
                t={t}
              />
            ) : (
              <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 text-gray-400">
                <Gift size={32} className="opacity-30" />
                <p className="text-sm">{t('luckyDraw.selectActivityHint')}</p>
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
          t={t}
        />
      )}
    </div>
  );
}
