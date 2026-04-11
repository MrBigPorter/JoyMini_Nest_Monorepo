'use client';

import React, {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from 'react';

export type Locale = 'zh' | 'en';

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
  const [locale, setLocale] = useState<Locale>('zh');

  return (
    <LanguageContext.Provider value={{ locale, setLocale }}>
      {children}
    </LanguageContext.Provider>
  );
};

export function useLanguage() {
  const context = useContext(LanguageContext);

  // ✅ 永远不抛出错误，安全降级到默认语言，防止整个页面崩溃
  if (!context) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(
        '[useLanguage] LanguageProvider not found in component tree. ' +
          'Falling back to default locale "zh". Make sure to wrap your app with <LanguageProvider>.',
      );
    }

    // 返回安全的默认实现，永远不会崩溃
    return {
      locale: 'zh' as const,
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
