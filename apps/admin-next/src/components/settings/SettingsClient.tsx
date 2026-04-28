'use client';

import React, { useState } from 'react';
import { useRequest } from 'ahooks';
import {
  Settings,
  RefreshCw,
  Edit2,
  X,
  Check,
  Plus,
  Trash2,
  Globe,
  Languages,
  AlertTriangle,
} from 'lucide-react';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { systemConfigApi } from '@/api';
import type { SystemConfigItem } from '@/type/types';
import { useToastStore } from '@/store/useToastStore.ts';
import { ModalManager, Switch } from '@repo/ui';
import { useAvailableLocales } from '@/hooks/useAvailableLocales';
import { useTranslation } from '@/hooks/useTranslation';

/** Common key readable labels and descriptions */
const CONFIG_META: Record<string, { label: string; description?: string }> = {
  exchange_rate_usd_php: {
    label: 'Exchange Rate (USD → PHP)',
    description: 'Used for balance display conversion',
  },
  exchange_rate_php_usd: {
    label: 'Exchange Rate (PHP → USD)',
    description: 'Reverse rate',
  },
  min_withdraw_amount: {
    label: 'Min Withdrawal Amount (PHP)',
    description: 'Minimum amount per withdrawal request',
  },
  max_withdraw_amount: {
    label: 'Max Withdrawal Amount (PHP)',
    description: 'Maximum amount per withdrawal request',
  },
  withdraw_fee_rate: {
    label: 'Withdrawal Fee Rate (%)',
    description: 'e.g. 0.02 = 2%',
  },
  platform_name: { label: 'Platform Name' },
  platform_email: { label: 'Support Email' },
  kyc_required: {
    label: 'KYC Required',
    description: '1 = required, 0 = optional',
  },
};

type TFunc = (key: string, params?: Record<string, string | number>) => string;

// New: Create configuration form component
function CreateConfigForm({
  onCreated,
  t,
}: {
  onCreated: () => void;
  t: TFunc;
}) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const handleSubmit = async () => {
    if (!key.trim() || !value.trim()) return;

    setCreating(true);
    try {
      await systemConfigApi.create({ key: key.trim(), value: value.trim() });
      onCreated();
      setKey('');
      setValue('');
      setShowForm(false);
    } catch (error) {
      // 4xx 由 HTTP 拦截器统一 toast，此处不重复 console.error
      const status = (error as { response?: { status?: number } })?.response
        ?.status;
      if (!status || status < 400 || status >= 500)
        console.error('Failed to create config:', error);
      alert(
        t('systemConfig.createFailed', {
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
      );
    } finally {
      setCreating(false);
    }
  };

  if (!showForm) {
    return (
      <button
        onClick={() => setShowForm(true)}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-500 rounded-lg hover:bg-teal-600 transition-colors"
      >
        <Plus size={16} />
        {t('systemConfig.createNew')}
      </button>
    );
  }

  return (
    <div className="p-4 mb-4 border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t('systemConfig.createNew')}
        </h3>
        <button
          onClick={() => setShowForm(false)}
          className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
        >
          <X size={16} />
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('systemConfig.configKey')}
          </label>
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t('systemConfig.configKeyPlaceholder')}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-white/10 rounded-lg bg-white dark:bg-gray-800"
            autoFocus
          />
          <p className="mt-1 text-xs text-gray-500">
            {t('systemConfig.configKeyHint')}
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('systemConfig.configValue')}
          </label>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('systemConfig.configValuePlaceholder')}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-white/10 rounded-lg bg-white dark:bg-gray-800"
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleSubmit}
            disabled={creating || !key.trim() || !value.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-teal-500 rounded-lg hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating
              ? t('systemConfig.creating')
              : t('systemConfig.createConfig')}
          </button>
          <button
            onClick={() => setShowForm(false)}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-white/10 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5"
          >
            {t('systemConfig.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfigRow({
  item,
  onSave,
  onDelete,
  t,
}: {
  item: SystemConfigItem;
  onSave: (key: string, value: string) => Promise<void>;
  onDelete: (key: string) => Promise<void>;
  t: TFunc;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.value);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const meta = CONFIG_META[item.key];
  const addToast = useToastStore((state) => state.addToast);

  const handleSave = async () => {
    if (draft === item.value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(item.key, draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    ModalManager.open({
      title: t('systemConfig.confirmDeleteTitle'),
      content: t('systemConfig.confirmDeleteContent', {
        label: meta?.label ?? item.key,
      }),
      confirmText: t('systemConfig.confirmDeleteText'),
      onConfirm: async () => {
        setDeleting(true);
        try {
          await onDelete(item.key);
        } catch (error) {
          addToast(
            'error',
            t('systemConfig.deleteFailed', {
              message: error instanceof Error ? error.message : 'Unknown error',
            }),
          );
        } finally {
          setDeleting(false);
        }
      },
    });
  };

  return (
    <div className="flex items-start justify-between gap-4 py-4 border-b border-gray-100 dark:border-white/5 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {meta?.label ?? item.key}
          </p>
          <code className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400 font-mono">
            {item.key}
          </code>
        </div>
        {meta?.description && (
          <p className="text-xs text-gray-400 mt-0.5">{meta.description}</p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {editing ? (
          <>
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSave();
                if (e.key === 'Escape') {
                  setDraft(item.value);
                  setEditing(false);
                }
              }}
              className="w-48 px-3 py-1.5 text-sm rounded-xl border border-teal-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
            />
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="p-1.5 rounded-lg bg-teal-500 text-white hover:bg-teal-600 disabled:opacity-50 transition-colors"
            >
              {saving ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <Check size={13} />
              )}
            </button>
            <button
              onClick={() => {
                setDraft(item.value);
                setEditing(false);
              }}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
            >
              <X size={13} />
            </button>
          </>
        ) : (
          <>
            <span className="text-sm font-mono text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-white/5 px-3 py-1.5 rounded-xl min-w-24 text-right">
              {item.value}
            </span>
            <button
              onClick={() => setEditing(true)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-teal-500 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
            >
              <Edit2 size={13} />
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
            >
              {deleting ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <Trash2 size={13} />
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

interface SystemConfigListResult {
  list: SystemConfigItem[];
}

interface SystemConfigProps {
  initialData?: SystemConfigListResult;
}

type Tab = 'general' | 'locales';

function LocaleSettingsContent({ t }: { t: TFunc }) {
  const { locales, toggleLocale, loading } = useAvailableLocales();

  if (loading) {
    return (
      <div className="p-8 text-center">{t('systemConfig.localeLoading')}</div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-gray-900 p-6">
        <div className="space-y-4">
          {locales.map((locale) => (
            <div
              key={locale.code}
              className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-white/5 last:border-0"
            >
              <div>
                <div className="font-medium">{locale.nativeName}</div>
                <div className="text-sm text-gray-500">{locale.name}</div>
              </div>

              <Switch
                checked={locale.enabled}
                onCheckedChange={() => toggleLocale(locale.code)}
                disabled={locale.isDefault}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
        <p className="font-medium mb-2">💡 {t('systemConfig.localeTip1')}</p>
        <ul className="list-disc list-inside space-y-1">
          <li>{t('systemConfig.localeTip1')}</li>
          <li>{t('systemConfig.localeTip2')}</li>
          <li>{t('systemConfig.localeTip3')}</li>
          <li>{t('systemConfig.localeTip4')}</li>
        </ul>
      </div>
    </div>
  );
}

export function SystemConfig({ initialData }: SystemConfigProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('general');
  const [configs, setConfigs] = useState<SystemConfigItem[]>(
    initialData?.list ?? [],
  );
  const hasServerPrefetch = Boolean(initialData?.list?.length);

  const { loading, run: refresh } = useRequest(() => systemConfigApi.getAll(), {
    ready: !hasServerPrefetch,
    onSuccess: (data) => setConfigs(data.list),
  });

  const handleSave = async (key: string, value: string) => {
    await systemConfigApi.update(key, value);
    setConfigs((prev) =>
      prev.map((c) => (c.key === key ? { ...c, value } : c)),
    );
  };

  const handleDelete = async (key: string) => {
    await systemConfigApi.delete(key);
    setConfigs((prev) => prev.filter((c) => c.key !== key));
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('systemConfig.pageTitle')}
        description={t('systemConfig.pageDescription')}
      />

      {/* Tab Navigation */}
      <div className="flex border-b border-gray-200 dark:border-white/10">
        <button
          onClick={() => setActiveTab('general')}
          className={`px-4 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'general'
              ? 'border-teal-500 text-teal-600 dark:text-teal-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <Settings size={16} />
          {t('systemConfig.tabGeneral')}
        </button>
        <button
          onClick={() => setActiveTab('locales')}
          className={`px-4 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'locales'
              ? 'border-teal-500 text-teal-600 dark:text-teal-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <Globe size={16} />
          {t('systemConfig.tabLocales')}
        </button>
      </div>

      {activeTab === 'general' && (
        <div className="rounded-2xl border border-gray-100 dark:border-white/10 bg-white dark:bg-gray-900 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/10">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
              <Settings size={16} className="text-teal-500" />
              {configs.length === 1
                ? t('systemConfig.configCount', { count: configs.length })
                : t('systemConfig.configCount_plural', {
                    count: configs.length,
                  })}
            </div>
            <div className="flex items-center gap-2">
              <CreateConfigForm onCreated={refresh} t={t} />
              <button
                onClick={refresh}
                disabled={loading}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
              >
                <RefreshCw
                  size={14}
                  className={loading ? 'animate-spin' : ''}
                />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="px-5">
            {loading && configs.length === 0 && (
              <div className="py-12 text-center text-gray-400 text-sm">
                {t('systemConfig.loading')}
              </div>
            )}
            {!loading && configs.length === 0 && (
              <div className="py-12 text-center text-gray-400 text-sm">
                <Settings size={32} className="mx-auto mb-2 opacity-30" />
                {t('systemConfig.emptyState')}
              </div>
            )}
            {configs.map((item) => (
              <ConfigRow
                key={item.key}
                item={item}
                onSave={handleSave}
                onDelete={handleDelete}
                t={t}
              />
            ))}
          </div>
        </div>
      )}

      {activeTab === 'locales' && <LocaleSettingsContent t={t} />}

      <div className="text-xs text-gray-400 px-1">
        {t('systemConfig.keyboardHint', {
          enterKey: 'Enter',
          escKey: 'Esc',
        })}
      </div>
    </div>
  );
}
