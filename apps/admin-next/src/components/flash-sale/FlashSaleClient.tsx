'use client';

import React, { useState } from 'react';
import { useRequest } from 'ahooks';
import {
  Zap,
  Plus,
  RefreshCw,
  Edit2,
  Trash2,
  ChevronRight,
  Package,
  X,
  Save,
  ArrowLeft,
} from 'lucide-react';
import type {
  FlashSaleSession,
  CreateFlashSaleSessionPayload,
} from '@/type/types';
import { FlashSaleBindProductModal } from '@/views/flash-sale/FlashSaleBindProductModal';
import { format } from 'date-fns';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { flashSaleApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { ModalManager } from '@repo/ui';
import { useTranslation } from '@/hooks/useTranslation';
import type { TFunc } from '@/hooks/useTranslation';

// ─── Session Modal ────────────────────────────────────────────────────────────

const sessionSchema = z.object({
  title: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  status: z.number(),
});
type SessionForm = z.infer<typeof sessionSchema>;

function SessionModal({
  session,
  onCloseAction,
  onSavedAction,
  t,
}: {
  session: FlashSaleSession | null;
  onCloseAction: () => void;
  onSavedAction: () => void;
  t: TFunc;
}) {
  const isEdit = !!session;
  const [saving, setSaving] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SessionForm>({
    defaultValues: {
      title: session?.title ?? '',
      startTime: session?.startTime
        ? format(new Date(session.startTime), "yyyy-MM-dd'T'HH:mm")
        : '',
      endTime: session?.endTime
        ? format(new Date(session.endTime), "yyyy-MM-dd'T'HH:mm")
        : '',
      status: session?.status ?? 1,
    },
  });

  const onSubmit = async (values: SessionForm) => {
    setSaving(true);
    try {
      const payload: CreateFlashSaleSessionPayload = {
        title: values.title,
        startTime: values.startTime,
        endTime: values.endTime,
        status: values.status,
      };
      if (isEdit) {
        await flashSaleApi.updateSession(session.id, payload);
      } else {
        await flashSaleApi.createSession(payload);
      }
      onSavedAction();
      onCloseAction();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/10">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            {isEdit ? t('flashSale.editSession') : t('flashSale.newSession')}
          </h3>
          <button
            onClick={onCloseAction}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">
              {t('flashSale.formTitle')}
            </label>
            <input
              {...register('title')}
              className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
            />
            {errors.title && (
              <p className="text-xs text-red-500">{t('flashSale.required')}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">
                {t('flashSale.formStartTime')}
              </label>
              <input
                type="datetime-local"
                {...register('startTime')}
                className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">
                {t('flashSale.formEndTime')}
              </label>
              <input
                type="datetime-local"
                {...register('endTime')}
                className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">
              {t('flashSale.formStatus')}
            </label>
            <select
              {...register('status', { valueAsNumber: true })}
              className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
            >
              <option value={1}>{t('flashSale.active')}</option>
              <option value={0}>{t('flashSale.inactive')}</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCloseAction}
              className="px-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
            >
              {t('flashSale.cancel')}
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
              {isEdit ? t('flashSale.save') : t('flashSale.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Products Panel ───────────────────────────────────────────────────────────

function SessionProductsPanel({
  session,
  onBack,
  onProductsChanged,
  t,
}: {
  session: FlashSaleSession;
  onBack: () => void;
  onProductsChanged: () => void;
  t: TFunc;
}) {
  const [showBind, setShowBind] = useState(false);

  const {
    data,
    loading,
    run: refresh,
  } = useRequest(() => flashSaleApi.getSessionProducts(session.id), {
    refreshDeps: [session.id],
  });
  const products = data?.list ?? [];

  const handleRemove = (productId: string) => {
    ModalManager.open({
      title: t('flashSale.removeProductTitle'),
      renderChildren: ({ close }) => (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {t('flashSale.removeProductConfirm')}
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="px-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
            >
              {t('flashSale.cancel')}
            </button>
            <button
              type="button"
              onClick={async () => {
                await flashSaleApi.removeProduct(productId);
                refresh();
                onProductsChanged();
                close();
              }}
              className="px-4 py-2 text-sm rounded-xl bg-red-500 hover:bg-red-600 text-white transition-colors"
            >
              {t('flashSale.remove')}
            </button>
          </div>
        </div>
      ),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-2 rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
        >
          <ArrowLeft size={16} />
        </button>
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            {session.title}
          </h2>
          <p className="text-xs text-gray-400">
            {format(new Date(session.startTime), 'MM/dd HH:mm')} →{' '}
            {format(new Date(session.endTime), 'MM/dd HH:mm')}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={loading}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setShowBind(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-teal-500 hover:bg-teal-600 text-white rounded-xl transition-colors"
          >
            <Plus size={13} />
            {t('flashSale.bindProduct')}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-gray-900 overflow-hidden">
        {products.length === 0 && !loading ? (
          <div className="py-12 text-center text-gray-400">
            <Package size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">{t('flashSale.noProducts')}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-white/10 bg-gray-50/50 dark:bg-white/3">
                {[
                  t('flashSale.colProduct'),
                  t('flashSale.colOriginalPrice'),
                  t('flashSale.colFlashPrice'),
                  t('flashSale.colStock'),
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
              {products.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-gray-50 dark:border-white/5"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {p.product?.treasureCoverImg && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.product.treasureCoverImg}
                          alt=""
                          className="w-8 h-8 rounded-lg object-cover"
                        />
                      )}
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {p.product?.treasureName ?? p.treasureId}
                        </p>
                        <p className="text-xs text-gray-400 font-mono">
                          {p.treasureId.slice(0, 10)}…
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    ₱{p.product?.unitAmount}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm font-semibold text-red-500">
                      ₱{p.flashPrice}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {p.flashStock}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => void handleRemove(p.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showBind && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <FlashSaleBindProductModal
            sessionId={session.id}
            onCloseAction={() => setShowBind(false)}
            onSavedAction={() => {
              setShowBind(false);
              refresh();
              onProductsChanged();
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export function FlashSaleManagement() {
  const { t } = useTranslation();
  const [modal, setModal] = useState<FlashSaleSession | null | 'new'>(null);
  const [selected, setSelected] = useState<FlashSaleSession | null>(null);

  const {
    data,
    loading,
    run: refresh,
  } = useRequest(() => flashSaleApi.getSessions());
  const sessions = data?.list ?? [];

  const handleDelete = (s: FlashSaleSession) => {
    ModalManager.open({
      title: t('flashSale.deleteTitle'),
      renderChildren: ({ close }) => (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {t('flashSale.deleteConfirm', { name: s.title })}
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="px-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
            >
              {t('flashSale.cancel')}
            </button>
            <button
              type="button"
              onClick={async () => {
                await flashSaleApi.deleteSession(s.id);
                refresh();
                close();
              }}
              className="px-4 py-2 text-sm rounded-xl bg-red-500 hover:bg-red-600 text-white transition-colors"
            >
              {t('flashSale.delete')}
            </button>
          </div>
        </div>
      ),
    });
  };

  if (selected) {
    return (
      <SessionProductsPanel
        session={selected}
        onBack={() => {
          setSelected(null);
          refresh();
        }}
        onProductsChanged={refresh}
        t={t}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('flashSale.pageTitle')}
        description={t('flashSale.pageDescription')}
        buttonText={t('flashSale.newSessionButton')}
        buttonOnClick={() => setModal('new')}
      />

      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-gray-900 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/10">
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            {sessions.length === 1
              ? t('flashSale.sessionCount', { count: sessions.length })
              : t('flashSale.sessionCount_plural', { count: sessions.length })}
          </span>
          <button
            onClick={refresh}
            disabled={loading}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {loading && sessions.length === 0 && (
          <div className="py-12 text-center text-gray-400 text-sm">
            {t('flashSale.loading')}
          </div>
        )}
        {!loading && sessions.length === 0 && (
          <div className="py-12 text-center text-gray-400">
            <Zap size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">{t('flashSale.noSessions')}</p>
          </div>
        )}

        <div className="divide-y divide-gray-50 dark:divide-white/5">
          {sessions.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50/50 dark:hover:bg-white/3 transition-colors"
            >
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center text-white flex-shrink-0">
                <Zap size={16} fill="white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  {s.title}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {format(new Date(s.startTime), 'MM/dd HH:mm')} →{' '}
                  {format(new Date(s.endTime), 'MM/dd HH:mm')}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${s.status === 1 ? 'bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400' : 'bg-gray-100 dark:bg-white/10 text-gray-400'}`}
                >
                  {s.status === 1
                    ? t('flashSale.active')
                    : t('flashSale.inactive')}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/10 px-2 py-0.5 rounded-full">
                  {s.productCount === 1
                    ? t('flashSale.productCount', { count: s.productCount })
                    : t('flashSale.productCount_plural', {
                        count: s.productCount,
                      })}
                </span>
                <button
                  onClick={() => setModal(s)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-teal-500 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
                >
                  <Edit2 size={13} />
                </button>
                <button
                  onClick={() => void handleDelete(s)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
                >
                  <Trash2 size={13} />
                </button>
                <button
                  onClick={() => setSelected(s)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-teal-500 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
                  title={t('flashSale.manageProducts')}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {modal !== null && (
        <SessionModal
          session={modal === 'new' ? null : modal}
          onCloseAction={() => setModal(null)}
          onSavedAction={refresh}
          t={t}
        />
      )}
    </div>
  );
}
