'use client';

import React, { useState } from 'react';
import { useAvailableLocales } from '@/hooks/useAvailableLocales';
import { type Locale } from '@lucky/shared';
import LocalizedFieldEditor from './LocalizedFieldEditor';

interface LocalizedStatusButtonsProps {
  values: Record<Locale, string | undefined>;
  fieldType: 'text' | 'textarea' | 'richtext';
  label: string;
  onSaveAction: (locale: Locale, value: string) => void;
  sourceLocale?: Locale;
}

export const LocalizedStatusButtons: React.FC<LocalizedStatusButtonsProps> = ({
  values,
  fieldType,
  label,
  onSaveAction,
  sourceLocale = 'zh',
}) => {
  const { enabledLocales, loading } = useAvailableLocales();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingLocale, setEditingLocale] = useState<Locale | null>(null);

  if (loading || enabledLocales.length <= 1) {
    return null;
  }

  const otherLocales = enabledLocales.filter((l) => l.code !== sourceLocale);

  const getStatusIndicator = (locale: Locale) => {
    const value = values[locale];
    if (value && value.trim().length > 0) {
      return '✨';
    }
    return '➕';
  };

  return (
    <div className="mt-4">
      <label className="block text-sm font-medium text-gray-600 mb-2">
        🌐 其他语言翻译
      </label>
      <div className="flex flex-wrap gap-2">
        {otherLocales.map((l) => (
          <button
            key={l.code}
            type="button"
            onClick={() => {
              setEditingLocale(l.code);
              setEditorOpen(true);
            }}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-1 ${
              values[l.code] && values[l.code]!.trim().length > 0
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                : 'bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200'
            }`}
          >
            {l.nativeName} {getStatusIndicator(l.code)}
          </button>
        ))}
      </div>

      {editingLocale && (
        <LocalizedFieldEditor
          isOpen={editorOpen}
          onCloseAction={() => setEditorOpen(false)}
          sourceLocale={sourceLocale}
          targetLocale={editingLocale}
          sourceValue={values[sourceLocale] || ''}
          currentValue={values[editingLocale] || ''}
          fieldType={fieldType}
          label={label}
          onSaveAction={(value) => onSaveAction(editingLocale, value)}
        />
      )}
    </div>
  );
};

export default LocalizedStatusButtons;
