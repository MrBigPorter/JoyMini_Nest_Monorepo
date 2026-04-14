import { getRequestConfig } from 'next-intl/server';
import { readdirSync } from 'fs';
import { resolve } from 'path';

// 文件到语言的映射配置
const FILE_TO_LOCALE = {
  'zh-CN': 'zh', // 文件zh-CN.json对应语言代码zh
  zh: 'zh', // 重命名后
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  fr: 'fr',
  de: 'de',
};

// 语言到文件的映射（反向）
const LOCALE_TO_FILE = Object.entries(FILE_TO_LOCALE).reduce(
  (acc, [file, locale]) => {
    acc[locale] = file;
    return acc;
  },
  {} as Record<string, string>,
);

/**
 * 获取支持的语言列表
 * 通过扫描src/messages/目录下的.json文件
 */
function getAvailableLocales(): string[] {
  const messagesDir = resolve(process.cwd(), 'src/messages');
  try {
    const files = readdirSync(messagesDir);
    const locales = files
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.replace('.json', ''))
      .map((fileCode) => FILE_TO_LOCALE[fileCode] || fileCode);

    // 去重（可能多个文件映射到同一个语言）
    return [...new Set(locales)];
  } catch (error) {
    console.warn('Failed to scan messages directory, using defaults:', error);
    return ['zh', 'en']; // 默认回退
  }
}

export default getRequestConfig(async ({ locale }) => {
  const availableLocales = getAvailableLocales();

  // 验证语言是否支持
  if (!availableLocales.includes(locale)) {
    // 回退到默认语言
    locale = 'zh';
  }

  // 获取对应的文件名
  const fileCode = LOCALE_TO_FILE[locale] || locale;

  try {
    const messages = (await import(`./src/messages/${fileCode}.json`)).default;
    return {
      locale,
      messages,
    };
  } catch (error) {
    // 文件加载失败，回退到默认语言
    console.warn(
      `Failed to load messages for ${locale}, falling back to zh:`,
      error,
    );

    const defaultFileCode = LOCALE_TO_FILE['zh'] || 'zh';
    const defaultMessages = (
      await import(`./src/messages/${defaultFileCode}.json`)
    ).default;
    return {
      locale: 'zh',
      messages: defaultMessages,
    };
  }
});
