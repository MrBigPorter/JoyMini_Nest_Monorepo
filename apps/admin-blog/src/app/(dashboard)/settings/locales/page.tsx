'use client';

import React from 'react';

import { useAvailableLocales } from '@/hooks/useAvailableLocales';
import { Switch } from '@repo/ui';
import { useTranslation } from '@/hooks/useTranslation';
import { PageHeader } from '@/components/scaffold/PageHeader';

export default function LocaleSettingsPage() {
  const { t } = useTranslation();
  const { locales, toggleLocale, loading } = useAvailableLocales();

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={t('systemConfig.tabLocales')}
          description={t('systemConfig.pageDescription')}
        />
        <div className="p-8 text-center">{t('systemConfig.localeLoading')}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('systemConfig.tabLocales')}
        description={t('systemConfig.pageDescription')}
      />

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
