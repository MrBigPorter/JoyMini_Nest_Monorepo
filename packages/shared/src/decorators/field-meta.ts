import { LocalizedString } from '../types/localized-string';

/**
 * 字段映射配置：枚举值 → 多语言标签
 *
 * @example
 * ```typescript
 * {
 *   1: { zh: "虚拟商品", en: "Virtual Product", ja: "バーチャル商品" },
 *   2: { zh: "实体商品", en: "Physical Product", ja: "実体商品" },
 * }
 * ```
 */
export interface FieldEnumMap {
  [value: number]: LocalizedString<string>;
}

/**
 * FieldMeta 装饰器的完整配置
 */
export interface FieldMetaOptions {
  /** 字段标签（多语言） */
  label: LocalizedString<string>;

  /** 枚举值映射（可选） */
  enum?: FieldEnumMap;

  /** 语义类型（可选，用于自动格式化） */
  type?: 'string' | 'number' | 'date' | 'amount';

  /** 示例值（可选） */
  example?: unknown;

  /**
   * 嵌套 DTO 类（可选）
   * 设置后 `toLLM()` 会递归序列化该字段
   */
  dtoClass?: new (...args: any[]) => any;
}

// ========================================
//  自定义元数据存储
//  使用 WeakMap 避免内存泄漏
//  不依赖 reflect-metadata 包
// ========================================

/** 每个类的属性级元数据（按 prototype 弱引用，用于 toLLM 等运行时） */
const classMetadata = new WeakMap<object, Map<string, FieldMetaOptions>>();

/**
 * 类名 → 元数据 映射（强引用，用于 Swagger/gen-types 等需要类名字符串的场景）
 *
 * 与 classMetadata（WeakMap）共享同一份 FieldMetaOptions 引用，
 * 但额外按 target.constructor.name 索引，避免 DTO 注册表。
 *
 * DTO 是应用生命周期对象，不存在内存泄漏风险。
 */
const classNameMetadata = new Map<string, Map<string, FieldMetaOptions>>();

/**
 * 获取指定类的属性元数据 Map（延迟初始化）
 */
function getOrCreateMetadataMap(target: object): Map<string, FieldMetaOptions> {
  let map = classMetadata.get(target);
  if (!map) {
    map = new Map();
    classMetadata.set(target, map);
  }
  return map;
}

/**
 * 字段元数据装饰器
 *
 * 在 DTO 属性上使用，同时服务于：
 * - AI 序列化（`toLLM()` 读取后输出 LLM 友好的语义数据）
 * - Swagger 文档（Phase 2 自动填充 `@ApiProperty`）
 * - 前端类型生成（Phase 3）
 *
 * 使用项目已有的 `LocalizedString<T>` 模式实现多语言，
 * 不依赖任何 i18n 库或 reflect-metadata。
 *
 * @param options - 字段元数据配置
 *
 * @example
 * ```typescript
 * class OrderItemDto {
 *   @FieldMeta({
 *     label: { zh: "订单状态", en: "Order Status" },
 *     enum: {
 *       1: { zh: "待支付", en: "Pending Payment" },
 *       2: { zh: "已支付", en: "Paid" },
 *       3: { zh: "已取消", en: "Cancelled" },
 *       4: { zh: "退款中", en: "Refunding" },
 *     },
 *   })
 *   orderStatus!: number;
 * }
 * ```
 */
export function FieldMeta(options: FieldMetaOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const key = String(propertyKey);

    // 1. 按 prototype 注册（WeakMap，用于 toLLM 运行时）
    const map = getOrCreateMetadataMap(target);
    map.set(key, options);

    // 2. 按类名注册（classNameMap，用于 Swagger/gen-types 按字符串查找）
    const className = (target as any)?.constructor?.name;
    if (className && className !== 'Object') {
      let classMap = classNameMetadata.get(className);
      if (!classMap) {
        classMap = new Map();
        classNameMetadata.set(className, classMap);
      }
      classMap.set(key, options);
    }
  };
}

/**
 * 读取 DTO 属性上的 @FieldMeta 元数据
 *
 * 兼容继承：如果当前类没有找到，会沿 prototype 链向上查找。
 *
 * @param target - DTO 类的 prototype（例如 `OrderItemDto.prototype`）
 * @param propertyKey - 属性名
 * @returns FieldMetaOptions 或 undefined
 */
export function getFieldMeta(
  target: object,
  propertyKey: string,
): FieldMetaOptions | undefined {
  let proto: object | null = target;

  while (proto) {
    const map = classMetadata.get(proto);
    if (map?.has(propertyKey)) {
      return map.get(propertyKey);
    }
    // 沿原型链向上查找（支持继承）
    proto = Object.getPrototypeOf(proto);
    if (proto === Object.prototype) break;
  }

  return undefined;
}

/**
 * 获取 DTO 类上所有定义了 @FieldMeta 的属性
 *
 * @param target - DTO 类的 prototype
 * @returns 属性名数组
 */
export function getFieldMetaKeys(target: object): string[] {
  const keys = new Set<string>();
  let proto: object | null = target;

  while (proto) {
    const map = classMetadata.get(proto);
    if (map) {
      for (const key of map.keys()) {
        keys.add(key);
      }
    }
    proto = Object.getPrototypeOf(proto);
    if (proto === Object.prototype) break;
  }

  return Array.from(keys);
}

/**
 * 通过类名字符串获取 @FieldMeta 元数据
 *
 * 替代方案：不需要导入 DTO class，也不需要 DTO 注册表。
 * 与 `getFieldMeta()` / `getFieldMetaKeys()` 共享同一份数据引用。
 *
 * @param className - DTO 类的 name（例如 "OrderItemDto"）
 * @returns FieldMetaOptions 的 Map，或 undefined
 */
export function getFieldMetasByClassName(
  className: string,
): Map<string, FieldMetaOptions> | undefined {
  return classNameMetadata.get(className);
}

/**
 * 通过类名字符串获取所有 @FieldMeta 属性名
 *
 * @param className - DTO 类的 name
 * @returns 属性名数组
 */
export function getFieldMetaKeysByClassName(className: string): string[] {
  const map = classNameMetadata.get(className);
  return map ? Array.from(map.keys()) : [];
}
