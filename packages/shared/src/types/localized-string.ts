/**
 * 全局唯一多语言字符串类型
 * 整个系统所有需要多语言的字段全部使用此类型
 * 不允许任何其他形式的多语言实现
 */

import { z } from "zod";

/**
 * 系统支持的语言列表
 * 新增语言只需要在这里加一行，整个系统自动支持
 */
export type Locale = "zh" | "en" | "ja" | "ko" | "fr" | "de";

/**
 * 多语言泛型类型
 * 不仅可以存字符串，还可以存数字、对象、数组等任何类型
 */
export type LocalizedString<T = string> = {
  [locale in Locale]?: T;
};

/**
 * 默认回退语言
 */
export const DEFAULT_LOCALE: Locale = "zh";

/**
 * 支持的语言列表
 */
export const AVAILABLE_LOCALES: Locale[] = ["zh", "en", "ja", "ko", "fr", "de"];

/**
 * 多语言字段 Zod Schema 生成器
 * @param valueSchema 单语言值的验证 Schema
 */
export function localizedStringSchema<T extends z.ZodTypeAny>(valueSchema: T) {
  //  完整双向兼容：同时支持 字符串值 和 对象结构
  return z.union([
    z.record(z.union([valueSchema, z.undefined()])),
    valueSchema.transform((value) => ({
      zh: value,
      en: "",
    })),
  ]);
}

/**
 * 工具函数：获取当前语言的内容
 * @param field 多语言字段
 * @param locale 当前语言
 * @param fallback 回退语言，默认 zh
 */
export function getLocalizedValue<T>(
  field: LocalizedString<T> | null | undefined,
  locale: Locale,
  fallback: Locale = DEFAULT_LOCALE,
): T | undefined {
  if (!field) return undefined;

  // 优先返回当前语言
  if (field[locale] !== undefined && field[locale] !== null) {
    return field[locale];
  }

  // 回退到默认语言
  if (
    fallback !== locale &&
    field[fallback] !== undefined &&
    field[fallback] !== null
  ) {
    return field[fallback];
  }

  // 遍历所有语言，返回第一个有值的
  for (const l of AVAILABLE_LOCALES) {
    if (field[l] !== undefined && field[l] !== null) {
      return field[l];
    }
  }

  return undefined;
}

/**
 * 工具函数：从旧的双字段格式迁移到新格式
 * @param zhValue 中文值
 * @param enValue 英文值
 */
export function migrateFromLegacyFields<T>(
  zhValue: T | null | undefined,
  enValue: T | null | undefined,
): LocalizedString<T> {
  const result: LocalizedString<T> = {};

  if (zhValue != null) result.zh = zhValue;
  if (enValue != null) result.en = enValue;

  return result;
}
