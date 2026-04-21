import { getRequestConfig } from 'next-intl/server';
import { notFound } from 'next/navigation';
import {
  getLocales,
  DEFAULT_LOCALE,
  getLocaleToFileMap,
} from '@/lib/i18n/config';

// 1. 定义支持的语言（使用共享配置）
export const locales = getLocales();
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = DEFAULT_LOCALE;

// 2. 文件映射表（使用共享配置）
const LOCALE_TO_FILE = getLocaleToFileMap();

export default getRequestConfig(async ({ requestLocale }) => {
  // 验证路径中的 locale 是否合法
  const currentLocale = (await requestLocale) || defaultLocale;
  // 检查是否是支持的语言
  if (!locales.includes(currentLocale as any)) {
    notFound();
  }

  const fileName = LOCALE_TO_FILE[currentLocale] || currentLocale;

  try {
    // 动态导入 JSON 消息文件
    const messages = (await import(`./src/messages/${fileName}.json`)).default;
    return {
      locale: currentLocale,
      messages,
      timeZone: 'Asia/Shanghai', // 配置时区
    };
  } catch (error) {
    // 回退到默认语言
    const defaultFileName = LOCALE_TO_FILE[defaultLocale] || defaultLocale;
    const defaultMessages = (
      await import(`./src/messages/${defaultFileName}.json`)
    ).default;
    return {
      locale: defaultLocale,
      messages: defaultMessages,
      timeZone: 'Asia/Shanghai',
    };
  }
});
