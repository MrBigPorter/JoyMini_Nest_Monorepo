'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import { AVAILABLE_LOCALES, DEFAULT_LOCALE, type Locale } from '@lucky/shared';

export interface LanguageContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined,
);

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  // 从localStorage读取保存的语言设置
  const getSavedLocale = (): Locale => {
    if (typeof window === 'undefined') return DEFAULT_LOCALE;
    const saved = localStorage.getItem('app_locale');
    if (saved && AVAILABLE_LOCALES.includes(saved as Locale)) {
      return saved as Locale;
    }
    return DEFAULT_LOCALE;
  };

  const [locale, setLocale] = useState<Locale>(getSavedLocale());

  // 保存语言设置到localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('app_locale', locale);
    }
  }, [locale]);

  return (
    <LanguageContext.Provider value={{ locale, setLocale }}>
      {children}
    </LanguageContext.Provider>
  );
};

export function useLanguage() {
  const context = useContext(LanguageContext);

  // 永远不抛出错误，安全降级到默认语言，防止整个页面崩溃
  if (!context) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(
        '[useLanguage] LanguageProvider not found in component tree. ' +
          `Falling back to default locale "${DEFAULT_LOCALE}". Make sure to wrap your app with <LanguageProvider>.`,
      );
    }

    // 返回安全的默认实现，永远不会崩溃
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => {
        if (process.env.NODE_ENV === 'development') {
          console.warn(
            '[useLanguage] setLocale called without LanguageProvider, ignored',
          );
        }
      },
    };
  }

  return context;
}

export function getLocalizedValue<T>(
  value: Record<string, T | undefined> | undefined,
  locale: Locale,
): T | undefined {
  if (!value) return undefined;
  return value[locale] as T;
}

// 重新导出 Locale 类型以保持向后兼容
export type { Locale };
