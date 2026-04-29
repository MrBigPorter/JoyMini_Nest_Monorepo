import { zhCN, enUS, ja, ko, fr, de } from 'date-fns/locale';
import type { Locale as DateFnsLocale } from 'date-fns';

/**
 * 根据应用locale获取对应的date-fns locale对象
 * 支持的语言: zh, en, ja, ko, fr, de
 * 默认回退到enUS
 */

export const getDateFnsLocale = (locale: string): DateFnsLocale => {
  switch (locale) {
    case 'zh':
      return zhCN;
    case 'en':
      return enUS;
    case 'ja':
      return ja;
    case 'ko':
      return ko;
    case 'fr':
      return fr;
    case 'de':
      return de;
    default:
      return enUS;
  }
};

/**
 * 获取所有支持的date-fns locale映射
 * 用于预加载或批量处理
 */
export const SUPPORTED_DATE_LOCALES: Record<string, DateFnsLocale> = {
  zh: zhCN,
  en: enUS,
  ja: ja,
  ko: ko,
  fr: fr,
  de: de,
};

/**
 * 检查给定的locale是否在date-fns中有对应的locale对象
 */
export const isDateLocaleSupported = (locale: string): boolean => {
  return locale in SUPPORTED_DATE_LOCALES;
};
