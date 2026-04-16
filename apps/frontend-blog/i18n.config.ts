import { getRequestConfig } from 'next-intl/server';
import { notFound } from 'next/navigation';

// 1. 定义支持的语言（静态配置，保持与原始设计一致）
// 实际可用的语言取决于是否存在对应的翻译文件
export const locales = ['zh', 'en', 'ja', 'ko', 'fr', 'de'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'zh';

// 2. 文件映射表（文件名到语言代码的映射）
const FILE_TO_LOCALE: Record<string, string> = {
  'zh-CN': 'zh', // 文件zh-CN.json对应语言代码zh
  zh: 'zh', // 重命名后
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  fr: 'fr',
  de: 'de',
};

// 3. 语言到文件的映射（反向）
const LOCALE_TO_FILE = Object.entries(FILE_TO_LOCALE).reduce(
  (acc, [file, locale]) => {
    acc[locale] = file;
    return acc;
  },
  {} as Record<string, string>,
);

// 4. 实际可用的语言（基于存在的翻译文件）
const AVAILABLE_LOCALES = ['zh', 'en'] as const;

export default getRequestConfig(async ({ locale }) => {
  // 验证路径中的 locale 是否合法
  const currentLocale = locale || defaultLocale;

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
    // 如果翻译文件不存在，检查是否是实际可用的语言
    if (!AVAILABLE_LOCALES.includes(currentLocale as any)) {
      console.warn(
        `Translation file missing for locale: ${currentLocale}, falling back to default`,
      );
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

    console.error(
      `Missing translation file for available locale: ${currentLocale}`,
    );
    notFound();
  }
});
