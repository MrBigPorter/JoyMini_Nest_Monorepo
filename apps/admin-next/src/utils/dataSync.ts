/**
 * 数据同步工具 - 提供表单值与多语言存储之间的可靠同步机制
 */

export interface SyncOptions {
  /** 是否启用深度比较 (默认: true) */
  deepCompare?: boolean;
  /** 同步延迟 (防抖, 默认: 50ms) */
  debounceDelay?: number;
  /** 最大重试次数 (默认: 3) */
  maxRetries?: number;
  /** 重试延迟 (默认: 100ms) */
  retryDelay?: number;
}

export interface SyncResult {
  success: boolean;
  changed: boolean;
  fieldName: string;
  fromLocale?: string;
  toLocale?: string;
  error?: string;
}

/**
 * 深度比较两个值是否相等
 */
export function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;

  if (typeof a !== typeof b) return false;

  if (a === null || b === null) return a === b;

  if (typeof a === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return false;

    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      return a.every((item, index) => deepEqual(item, b[index]));
    }

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    return keysA.every((key) => deepEqual(a[key], b[key]));
  }

  return a === b;
}

/**
 * 安全的JSON字符串化，处理循环引用
 */
export function safeStringify(obj: any): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  });
}

/**
 * 防抖函数
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * 重试函数
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 100,
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delay * attempt));
      }
    }
  }

  throw lastError!;
}

/**
 * 同步表单值与多语言存储
 */
export class DataSynchronizer {
  private storage: Record<string, Record<string, any>> = {};
  private pendingSyncs: Map<string, NodeJS.Timeout> = new Map();
  private options: Required<SyncOptions>;

  constructor(options: SyncOptions = {}) {
    this.options = {
      deepCompare: true,
      debounceDelay: 50,
      maxRetries: 3,
      retryDelay: 100,
      ...options,
    };
  }

  /**
   * 同步单个字段
   */
  async syncField(
    fieldName: string,
    formValue: any,
    locale: string,
    allLocales: string[] = [],
  ): Promise<SyncResult> {
    try {
      const currentStored = this.storage[fieldName]?.[locale];
      const hasChanged = this.options.deepCompare
        ? !deepEqual(currentStored, formValue)
        : currentStored !== formValue;

      if (!hasChanged) {
        return {
          success: true,
          changed: false,
          fieldName,
          fromLocale: locale,
        };
      }

      // 更新存储
      if (!this.storage[fieldName]) {
        this.storage[fieldName] = {};
      }

      this.storage[fieldName][locale] = formValue;

      // 如果需要，同步到其他语言（保持一致性）
      if (allLocales.length > 0) {
        await this.syncToOtherLocales(fieldName, locale, formValue, allLocales);
      }

      return {
        success: true,
        changed: true,
        fieldName,
        fromLocale: locale,
      };
    } catch (error) {
      return {
        success: false,
        changed: false,
        fieldName,
        fromLocale: locale,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 防抖同步
   */
  debouncedSync(
    fieldName: string,
    formValue: any,
    locale: string,
    allLocales: string[] = [],
  ): void {
    const key = `${fieldName}:${locale}`;

    // 清除之前的定时器
    if (this.pendingSyncs.has(key)) {
      clearTimeout(this.pendingSyncs.get(key)!);
    }

    // 设置新的定时器
    const timeout = setTimeout(async () => {
      try {
        await withRetry(
          () => this.syncField(fieldName, formValue, locale, allLocales),
          this.options.maxRetries,
          this.options.retryDelay,
        );
      } catch (error) {
        console.error(`Failed to sync field ${fieldName}:`, error);
      } finally {
        this.pendingSyncs.delete(key);
      }
    }, this.options.debounceDelay);

    this.pendingSyncs.set(key, timeout);
  }

  /**
   * 批量同步多个字段
   */
  async syncMultiple(
    fields: Array<{ fieldName: string; formValue: any }>,
    locale: string,
    allLocales: string[] = [],
  ): Promise<SyncResult[]> {
    const results: SyncResult[] = [];

    for (const field of fields) {
      const result = await this.syncField(
        field.fieldName,
        field.formValue,
        locale,
        allLocales,
      );
      results.push(result);
    }

    return results;
  }

  /**
   * 获取所有字段名
   */
  getAllFieldNames(): string[] {
    return Object.keys(this.storage);
  }

  /**
   * 获取字段的所有语言值
   */
  getFieldAllLocales(fieldName: string): Record<string, any> {
    return this.storage[fieldName] || {};
  }

  /**
   * 获取特定语言的字段值
   */
  getFieldValue(fieldName: string, locale: string): any {
    return this.storage[fieldName]?.[locale];
  }

  /**
   * 设置字段值（直接操作存储）
   */
  setFieldValue(fieldName: string, locale: string, value: any): void {
    if (!this.storage[fieldName]) {
      this.storage[fieldName] = {};
    }
    this.storage[fieldName][locale] = value;
  }

  /**
   * 清除字段的所有语言值
   */
  clearField(fieldName: string): void {
    delete this.storage[fieldName];
  }

  /**
   * 清除所有存储
   */
  clearAll(): void {
    this.storage = {};
    this.pendingSyncs.forEach((timeout) => clearTimeout(timeout));
    this.pendingSyncs.clear();
  }

  /**
   * 导出所有数据
   */
  exportData(): Record<string, Record<string, any>> {
    return JSON.parse(safeStringify(this.storage));
  }

  /**
   * 导入数据
   */
  importData(data: Record<string, Record<string, any>>): void {
    this.storage = JSON.parse(safeStringify(data));
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const fieldCount = Object.keys(this.storage).length;
    let totalValues = 0;

    Object.values(this.storage).forEach((localeValues) => {
      totalValues += Object.keys(localeValues).length;
    });

    return {
      fieldCount,
      totalValues,
      pendingSyncs: this.pendingSyncs.size,
    };
  }

  private async syncToOtherLocales(
    fieldName: string,
    sourceLocale: string,
    sourceValue: any,
    allLocales: string[],
  ): Promise<void> {
    // 这里可以实现跨语言同步策略
    // 例如：当某个语言的值被清空时，可以尝试从其他语言获取默认值
    // 或者：当主语言更新时，自动标记其他语言为需要翻译
    // 当前实现：只记录变更，不自动同步到其他语言
    // 可以扩展为更复杂的同步策略
  }
}

/**
 * 创建数据同步器实例
 */
export function createDataSynchronizer(
  options?: SyncOptions,
): DataSynchronizer {
  return new DataSynchronizer(options);
}

/**
 * 默认全局同步器实例
 */
export const defaultSynchronizer = createDataSynchronizer();
