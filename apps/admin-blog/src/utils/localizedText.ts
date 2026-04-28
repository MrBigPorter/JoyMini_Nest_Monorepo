/**
 * 统一的多语言文本渲染工具
 * 解决 [object Object] 显示问题，确保所有地方正确处理多语言数据
 */

/**
 * 渲染多语言文本
 * @param value - 可以是字符串、多语言对象 {en: "...", zh: "..."} 或其他类型
 * @param locale - 当前语言代码，默认 'zh'
 * @param fallback - 回退文本，默认空字符串
 * @returns 渲染后的字符串
 */
export const renderLocalizedText = (
  value: any,
  locale: string = 'zh',
  fallback: string = '',
): string => {
  // 处理 null/undefined
  if (value == null) return fallback;

  // 如果是字符串，直接返回
  if (typeof value === 'string') return value;

  // 如果是多语言对象
  if (typeof value === 'object' && value !== null) {
    // 优先使用当前语言
    if (value[locale]) return String(value[locale]);

    // 回退到中文
    if (value.zh) return String(value.zh);

    // 回退到英文
    if (value.en) return String(value.en);

    // 尝试获取第一个可用的语言值
    const firstValue = Object.values(value).find((v) => v != null);
    if (firstValue) return String(firstValue);

    return fallback;
  }

  // 其他类型转换为字符串
  return String(value);
};

/**
 * 获取多语言对象的指定语言值
 * @param obj - 多语言对象 {en: "...", zh: "..."}
 * @param locale - 语言代码
 * @returns 指定语言的值，如果不存在则返回空字符串
 */
export const getLocalizedValue = (
  obj: Record<string, any> | undefined | null,
  locale: string = 'zh',
): string => {
  if (!obj) return '';
  return obj[locale] || obj.zh || obj.en || '';
};

/**
 * 检查值是否为多语言对象
 * @param value - 要检查的值
 * @returns 是否为多语言对象格式
 */
export const isLocalizedObject = (value: any): boolean => {
  if (!value || typeof value !== 'object') return false;

  // 检查是否包含常见的语言键
  const hasLanguageKey = Object.keys(value).some((key) =>
    ['en', 'zh', 'ja', 'ko', 'fr', 'es', 'de'].includes(key),
  );

  return hasLanguageKey;
};

/**
 * 标准化多语言数据
 * 将旧格式（name, nameEn）转换为新格式（{en: "...", zh: "..."}）
 * @param data - 原始数据
 * @returns 标准化后的多语言对象
 */
export const normalizeLocalizedData = (data: any): Record<string, string> => {
  if (!data) return { zh: '', en: '' };

  // 如果已经是多语言对象，直接返回
  if (isLocalizedObject(data)) {
    return {
      zh: data.zh || '',
      en: data.en || '',
      ...data,
    };
  }

  // 如果是字符串，当作中文
  if (typeof data === 'string') {
    return { zh: data, en: '' };
  }

  // 如果是旧格式（name, nameEn）
  if (data.name && typeof data.name === 'string') {
    return {
      zh: data.name,
      en: data.nameEn || '',
    };
  }

  // 默认返回空对象
  return { zh: '', en: '' };
};

/**
 * 批量渲染表格中的多语言字段
 * @param data - 表格数据数组
 * @param fields - 需要渲染的多语言字段名数组
 * @param locale - 当前语言
 * @returns 处理后的数据
 */
export const renderLocalizedTableData = <T extends Record<string, any>>(
  data: T[],
  fields: string[],
  locale: string = 'zh',
): T[] => {
  return data.map((item) => {
    const processed = { ...item } as any;

    fields.forEach((field) => {
      if (field in processed) {
        processed[field] = renderLocalizedText(processed[field], locale);
      }
    });

    return processed as T;
  });
};
