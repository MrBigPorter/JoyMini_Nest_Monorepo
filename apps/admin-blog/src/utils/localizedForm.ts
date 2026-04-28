/**
 * 多语言表单工具函数
 * 用于规范化多语言值，确保所有模态框的数据处理一致
 */

/**
 * 规范化多语言值，确保返回标准的多语言对象
 * @param value - 可以是字符串、多语言对象或其他类型
 * @returns 标准化的多语言对象 {zh: string, en: string, ...}
 */
export function normalizeLocalizedValue(value: any): Record<string, string> {
  if (!value) return { zh: "", en: "" };

  if (typeof value === "string") {
    return { zh: value, en: "" };
  }

  if (typeof value === "object") {
    // 确保至少包含 zh 和 en 键
    return {
      zh: value.zh || "",
      en: value.en || "",
      ...value,
    };
  }

  return { zh: "", en: "" };
}

/**
 * 提取当前语言的本地化值
 * @param value - 可以是字符串、多语言对象或其他类型
 * @param locale - 当前语言代码
 * @returns 指定语言的值，如果不存在则返回空字符串
 */
export function extractCurrentLocaleValue(value: any, locale: string): string {
  const normalized = normalizeLocalizedValue(value);
  return normalized[locale] || normalized["zh"] || normalized["en"] || "";
}

/**
 * 安全获取多语言对象中的值
 * @param obj - 多语言对象
 * @param locale - 语言代码
 * @param fallback - 回退值，默认空字符串
 * @returns 安全提取的值
 */
export function getSafeLocalizedValue(
  obj: any,
  locale: string,
  fallback: string = "",
): string {
  if (!obj || typeof obj !== "object") return fallback;

  // 优先使用当前语言
  if (obj[locale] !== undefined && obj[locale] !== null) {
    return String(obj[locale]);
  }

  // 回退到中文
  if (obj.zh !== undefined && obj.zh !== null) {
    return String(obj.zh);
  }

  // 回退到英文
  if (obj.en !== undefined && obj.en !== null) {
    return String(obj.en);
  }

  // 尝试获取第一个可用的值
  const firstValue = Object.values(obj).find((v) => v != null);
  if (firstValue !== undefined) {
    return String(firstValue);
  }

  return fallback;
}

/**
 * 检查值是否为多语言对象
 * @param value - 要检查的值
 * @returns 是否为多语言对象
 */
export function isLocalizedObject(value: any): boolean {
  if (!value || typeof value !== "object") return false;

  // 检查是否包含常见的语言键
  const hasLanguageKey = Object.keys(value).some((key) =>
    ["zh", "en", "ja", "ko", "fr", "de"].includes(key),
  );

  return hasLanguageKey;
}

/**
 * 将字符串值转换为多语言对象
 * @param value - 字符串值
 * @param locale - 目标语言，默认 'zh'
 * @returns 多语言对象
 */
export function stringToLocalizedObject(
  value: string,
  locale: string = "zh",
): Record<string, string> {
  const result: Record<string, string> = { zh: "", en: "" };
  result[locale] = value || "";
  return result;
}
