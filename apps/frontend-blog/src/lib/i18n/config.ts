/**
 * i18n共享配置
 *
 * 集中管理所有语言配置，避免分散在多个文件中
 * 新增语言只需在此文件中添加配置
 */

// ==================== 基础语言定义 ====================

/**
 * 支持的所有语言代码
 * 新增语言时在此添加
 */
export const LOCALES = ['zh', 'en', 'ja', 'ko', 'fr', 'de'] as const;

/**
 * 语言代码类型
 */
export type Locale = (typeof LOCALES)[number];

/**
 * 默认语言
 */
export const DEFAULT_LOCALE: Locale = 'zh';

// ==================== 语言元数据配置 ====================

/**
 * 语言元数据配置
 */
export interface LocaleMetadata {
  /** 语言代码，如 'zh', 'en' */
  code: Locale;
  /** 英文名称，用于显示 */
  name: string;
  /** 本地名称，用于语言切换器显示 */
  nativeName: string;
  /** 是否为默认语言 */
  isDefault: boolean;
  /** 翻译文件名 */
  fileName: string;
  /** 是否启用该语言 */
  enabled: boolean;
}

/**
 * 所有语言的完整元数据配置
 * 新增语言时在此添加完整配置
 */
export const LOCALES_METADATA: Record<Locale, LocaleMetadata> = {
  zh: {
    code: 'zh',
    name: 'Chinese',
    nativeName: '简体中文',
    isDefault: true,
    fileName: 'zh',
    enabled: true,
  },
  en: {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    isDefault: false,
    fileName: 'en',
    enabled: true,
  },
  ja: {
    code: 'ja',
    name: 'Japanese',
    nativeName: '日本語',
    isDefault: false,
    fileName: 'ja',
    enabled: true,
  },
  ko: {
    code: 'ko',
    name: 'Korean',
    nativeName: '한국어',
    isDefault: false,
    fileName: 'ko',
    enabled: true,
  },
  fr: {
    code: 'fr',
    name: 'French',
    nativeName: 'Français',
    isDefault: false,
    fileName: 'fr',
    enabled: true,
  },
  de: {
    code: 'de',
    name: 'German',
    nativeName: 'Deutsch',
    isDefault: false,
    fileName: 'de',
    enabled: true,
  },
};

// ==================== 工具函数 ====================

/**
 * 获取所有语言代码数组
 */
export function getLocales(): readonly Locale[] {
  return LOCALES;
}

/**
 * 获取语言元数据
 */
export function getLocaleMetadata(code: string): LocaleMetadata | undefined {
  return LOCALES_METADATA[code as Locale];
}

/**
 * 获取启用的语言列表
 * 基于 LOCALES_METADATA 中的 enabled 字段
 */
export function getEnabledLocales(): Locale[] {
  return Object.values(LOCALES_METADATA)
    .filter((locale) => locale.enabled)
    .map((locale) => locale.code);
}

/**
 * 检查语言是否启用
 */
export function isLocaleEnabled(code: string): boolean {
  const metadata = LOCALES_METADATA[code as Locale];
  return metadata ? metadata.enabled : false;
}

/**
 * 获取语言到文件的映射
 */
export function getLocaleToFileMap(): Record<string, string> {
  const map: Record<string, string> = {};

  Object.values(LOCALES_METADATA).forEach((locale) => {
    map[locale.code] = locale.fileName;
  });

  return map;
}

/**
 * 获取文件到语言的映射
 */
export function getFileToLocaleMap(): Record<string, string> {
  const map: Record<string, string> = {};

  Object.values(LOCALES_METADATA).forEach((locale) => {
    map[locale.fileName] = locale.code;
  });

  return map;
}
