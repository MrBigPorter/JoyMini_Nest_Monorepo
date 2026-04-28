'use client';

import React from 'react';
import { useLanguage } from '@/hooks/LanguageProvider';
import { useAvailableLocales } from '@/hooks/useAvailableLocales';

export const LanguageSwitch: React.FC = () => {
  const { locale, setLocale } = useLanguage();
  const { enabledLocales, loading } = useAvailableLocales();

  if (loading || enabledLocales.length <= 1) {
    return null;
  }

  return (
    <div className="flex items-center space-x-1">
      {enabledLocales.map((l: any) => (
        <button
          key={l.code}
          type="button"
          onClick={() => setLocale(l.code as any)}
          className={`px-2 py-1 text-xs rounded transition-colors ${
            locale === l.code
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
        >
          {l.nativeName}
        </button>
      ))}
    </div>
  );
};

export default LanguageSwitch;
