'use client';

import React from 'react';

import { useAvailableLocales } from '@/hooks/useAvailableLocales';
import { Switch } from '@repo/ui';
// @ts-expect-error Card component requires title/href props but we use it without
import { Card } from '@repo/ui/card.tsx';

export default function LocaleSettingsPage() {
  const { locales, toggleLocale, loading } = useAvailableLocales();

  if (loading) {
    return <div className="p-8 text-center">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">语言管理</h1>
        <p className="text-gray-500 mt-1">
          启用或禁用系统支持的语言。更改会实时生效，不需要重新部署。
        </p>
      </div>

      <Card className="p-6">
        <div className="space-y-4">
          {locales.map((locale) => (
            <div
              key={locale.code}
              className="flex items-center justify-between py-3 border-b last:border-0"
            >
              <div>
                <div className="font-medium">{locale.nativeName}</div>
                <div className="text-sm text-gray-500">{locale.name}</div>
              </div>

              <Switch
                checked={locale.enabled}
                onCheckedChange={() => toggleLocale(locale.code)}
              />
            </div>
          ))}
        </div>
      </Card>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
        <p className="font-medium mb-2">💡 提示</p>
        <ul className="list-disc list-inside space-y-1">
          <li>关闭语言不会删除已有的翻译内容</li>
          <li>重新打开语言时，之前的翻译会自动恢复</li>
          <li>新启用的语言会在后台自动开始翻译所有历史内容</li>
          <li>默认语言 (中文) 无法关闭</li>
        </ul>
      </div>
    </div>
  );
}
