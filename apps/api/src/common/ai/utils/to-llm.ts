import { getFieldMeta, getLocalizedValue, type Locale } from '@lucky/shared';
import dayjs from 'dayjs';

/**
 * 通用 AI 序列化器
 *
 * 读取 DTO 上的 @FieldMeta 元数据，按 locale 输出 LLM 友好的格式。
 * 枚举值自动替换为对应语言的标签，金额/日期自动格式化。
 *
 * @param instance - DTO 实例（通常从 Prisma/Service 返回）
 * @param dtoClass - DTO 类（用于读取 prototype 上的元数据）
 * @param locale - 输出语言，默认 'zh'
 * @param options - 可选配置
 * @param options.arrayItemClass - 如果 instance 是数组，指定数组元素的 DTO 类
 * @returns 语义化的扁平对象
 *
 * @example
 * ```typescript
 * toLLM(orderItem, OrderItemDto, 'zh')
 * // { "订单状态": "已支付", "商品类型": "实体商品", "实付金额": "¥9.98" }
 *
 * toLLM(orderItem, OrderItemDto, 'en')
 * // { "Order Status": "Paid", "Product Type": "Physical Product", "Amount": "¥9.98" }
 * ```
 */
export function toLLM<T extends object>(
  instance: T,
  dtoClass: new (...args: any[]) => T,
  locale: Locale = 'zh',
  options?: {
    /** 如果 instance 是数组，指定数组元素的 DTO 类 */
    arrayItemClass?: new (...args: any[]) => any;
  },
): Record<string, any> {
  const result: Record<string, any> = {};
  const prototype = dtoClass.prototype;

  // 处理数组类型
  if (Array.isArray(instance) && options?.arrayItemClass) {
    return (instance as any[]).map((item) =>
      toLLM(item, options.arrayItemClass!, locale),
    );
  }

  for (const key of Object.keys(instance as any)) {
    const meta = getFieldMeta(prototype, key);
    if (!meta) continue;

    const rawValue = (instance as any)[key];
    const fieldLabel = getLocalizedValue(meta.label, locale) ?? key;

    // 处理嵌套 DTO
    if (meta.dtoClass && rawValue && typeof rawValue === 'object') {
      if (Array.isArray(rawValue)) {
        result[fieldLabel] = rawValue.map((item: any) =>
          toLLM(item, meta.dtoClass!, locale),
        );
      } else {
        result[fieldLabel] = toLLM(rawValue, meta.dtoClass, locale);
      }
      continue;
    }

    // 处理枚举映射
    if (meta.enum && rawValue !== null && rawValue !== undefined) {
      const enumLabels = meta.enum[rawValue];
      if (enumLabels) {
        result[fieldLabel] = getLocalizedValue(enumLabels, locale) ?? rawValue;
        continue;
      }
    }

    // 按语义类型自动格式化
    switch (meta.type) {
      case 'date':
        result[fieldLabel] = dayjs(rawValue).isValid()
          ? dayjs(rawValue).format('YYYY/M/D HH:mm')
          : rawValue;
        break;
      case 'amount':
        // 统一使用 ¥ 前缀表示金额
        result[fieldLabel] = `¥${rawValue}`;
        break;
      default:
        result[fieldLabel] = rawValue;
    }
  }

  return result;
}
