/**
 * 多语言共享配置
 *
 * 集中管理所有语言配置，避免分散在多个文件中
 * 新增语言只需在此文件中添加配置
 */

// ==================== 基础语言定义 ====================

/**
 * 支持的所有语言代码
 * 新增语言时在此添加
 */
export const ALL_LOCALE_CODES = ["zh", "en", "ja", "ko", "fr", "de"] as const;

/**
 * 语言代码类型
 */
export type LocaleCode = (typeof ALL_LOCALE_CODES)[number];

/**
 * 默认语言
 */
export const DEFAULT_LOCALE: LocaleCode = "zh";

// ==================== 语言元数据配置 ====================

/**
 * 语言元数据配置
 */
export interface LocaleMetadata {
  /** 语言代码，如 'zh', 'en' */
  code: LocaleCode;
  /** 英文名称，用于显示 */
  name: string;
  /** 本地名称，用于语言切换器显示 */
  nativeName: string;
  /** 是否为默认语言 */
  isDefault: boolean;
  /** 翻译文件名（可选，用于文件映射） */
  fileName?: string;
}

/**
 * 所有语言的完整元数据配置
 * 新增语言时在此添加完整配置
 */
export const ALL_LOCALES_METADATA: readonly LocaleMetadata[] = [
  {
    code: "zh",
    name: "Chinese",
    nativeName: "简体中文",
    isDefault: true,
    fileName: "zh",
  },
  {
    code: "en",
    name: "English",
    nativeName: "English",
    isDefault: false,
    fileName: "en",
  },
  {
    code: "ja",
    name: "Japanese",
    nativeName: "日本語",
    isDefault: false,
    fileName: "ja",
  },
  {
    code: "ko",
    name: "Korean",
    nativeName: "한국어",
    isDefault: false,
    fileName: "ko",
  },
  {
    code: "fr",
    name: "French",
    nativeName: "Français",
    isDefault: false,
    fileName: "fr",
  },
  {
    code: "de",
    name: "German",
    nativeName: "Deutsch",
    isDefault: false,
    fileName: "de",
  },
] as const;

// ==================== 工具函数 ====================

/**
 * 根据语言代码获取元数据
 */
export function getLocaleMetadata(code: string): LocaleMetadata | undefined {
  return ALL_LOCALES_METADATA.find((locale) => locale.code === code);
}

/**
 * 获取启用的语言列表（从环境变量或默认值）
 * 格式：逗号分隔的语言代码，如 "zh,en,ja"
 */
export function getEnabledLocaleCodes(): LocaleCode[] {
  // 从环境变量读取，如果没有则使用默认值
  const envValue = process.env.NEXT_PUBLIC_ENABLED_LOCALES;

  if (envValue) {
    const codes = envValue.split(",").map((code) => code.trim() as LocaleCode);
    // 过滤掉无效的语言代码
    return codes.filter((code) => ALL_LOCALE_CODES.includes(code));
  }

  // 默认启用中文、英文、日文、韩文
  return ["zh", "en", "ja", "ko"];
}

/**
 * 获取启用的语言元数据
 */
export function getEnabledLocales(): LocaleMetadata[] {
  const enabledCodes = getEnabledLocaleCodes();
  return ALL_LOCALES_METADATA.filter((locale) =>
    enabledCodes.includes(locale.code),
  );
}

/**
 * 检查语言是否启用
 */
export function isLocaleEnabled(code: string): boolean {
  return getEnabledLocaleCodes().includes(code as LocaleCode);
}

/**
 * 获取语言到文件的映射
 */
export function getLocaleToFileMap(): Record<string, string> {
  const map: Record<string, string> = {};

  ALL_LOCALES_METADATA.forEach((locale) => {
    if (locale.fileName) {
      map[locale.code] = locale.fileName;
    }
  });

  return map;
}

/**
 * 获取文件到语言的映射
 */
export function getFileToLocaleMap(): Record<string, string> {
  const map: Record<string, string> = {};

  ALL_LOCALES_METADATA.forEach((locale) => {
    if (locale.fileName) {
      map[locale.fileName] = locale.code;
    }
  });

  return map;
}
