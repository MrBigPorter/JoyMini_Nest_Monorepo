"use client";

import { useCallback, useEffect, useRef, useMemo } from "react";
import {
  FieldValues,
  Path,
  PathValue,
  UseFormWatch,
  UseFormSetValue,
  UseFormGetValues,
} from "react-hook-form";
import { createDataSynchronizer, DataSynchronizer } from "@/utils/dataSync";
import { normalizeLocalizedValue } from "@/utils/localizedForm";

interface UseLocalizedFormOptions<T extends FieldValues> {
  // 分别接收需要的属性，而不是整个 form 对象，避免 Next.js 编译器报错 TS71007
  watch: UseFormWatch<T>;
  setValue: UseFormSetValue<T>;
  getValues: UseFormGetValues<T>;
  locale: string;
  availableLocales?: string[];
  synchronizer?: DataSynchronizer;
}

interface UseLocalizedFormReturn<T extends FieldValues> {
  /**
   * 本地化字段 - 将字段包装为多语言感知
   */

  localize: (fieldName: keyof T) => {
    value: string;
    onChange: (value: any) => void;
    name: string;
  };

  /**
   * 获取字段的所有语言值
   */
  getFullLocalizedValue: (fieldName: keyof T) => Record<string, string>;

  /**
   * 切换语言
   */
  switchLocale: (newLocale: string) => void;

  /**
   * 获取同步器实例
   */
  getSynchronizer: () => DataSynchronizer;

  /**
   * 导出所有多语言数据
   */
  exportLocalizedData: () => Record<string, Record<string, string>>;

  /**
   * 导入多语言数据
   */
  importLocalizedData: (data: Record<string, Record<string, string>>) => void;
}

/**
 * 改进版多语言表单Hook - 使用数据同步器提供可靠的数据同步
 */
export function useLocalizedFormV2<T extends FieldValues>({
  watch,
  setValue,
  getValues,
  locale,
  availableLocales = [],
  synchronizer: externalSynchronizer,
}: UseLocalizedFormOptions<T>): UseLocalizedFormReturn<T> {
  const prevLocaleRef = useRef(locale);
  const synchronizerRef = useRef<DataSynchronizer>(
    externalSynchronizer || createDataSynchronizer(),
  );

  // 获取同步器实例
  const synchronizer = synchronizerRef.current;

  // 监听字段变化并同步到存储
  useEffect(() => {
    const subscription = watch(
      (value: any, { name, type }: { name?: string; type?: string }) => {
        if (name && type === "change") {
          // 安全地获取字段值
          const fieldValue = (value as any)[name];

          // 防抖同步到存储
          synchronizer.debouncedSync(
            name,
            fieldValue,
            locale,
            availableLocales,
          );
        }
      },
    );

    return () => subscription.unsubscribe();
  }, [watch, locale, availableLocales, synchronizer]);

  // 语言切换处理
  useEffect(() => {
    const prevLocale = prevLocaleRef.current;

    if (prevLocale !== locale) {
      // 获取所有已同步的字段
      const allFields = synchronizer.getAllFieldNames();

      // 切换语言时，从存储中读取新语言的值并设置到表单
      allFields.forEach((fieldName) => {
        const storedValue = synchronizer.getFieldValue(fieldName, locale);
        const currentValue = getValues(fieldName as Path<T>);

        // 只有当存储的值与当前值不同时才更新
        if (storedValue !== undefined && storedValue !== currentValue) {
          setValue(fieldName as Path<T>, storedValue as PathValue<T, Path<T>>, {
            shouldDirty: false,
            shouldTouch: false,
            shouldValidate: false,
          });
        }
      });

      prevLocaleRef.current = locale;
    }
  }, [locale, setValue, getValues, synchronizer]);

  const localize = useCallback(
    (fieldName: keyof T) => {
      const fieldKey = String(fieldName);
      const fieldPath = fieldName as Path<T>;
      const rawValue = watch(fieldPath);

      // 初始化处理：如果检测到多语言对象，立即同步到存储
      if (
        rawValue &&
        typeof rawValue === "object" &&
        !((rawValue as any) instanceof File)
      ) {
        // 规范化多语言对象
        const normalized = normalizeLocalizedValue(rawValue);

        // 同步所有语言的值到存储
        Object.entries(normalized).forEach(([lang, value]) => {
          synchronizer.setFieldValue(fieldKey, lang, value);
        });

        // 设置当前语言的值到表单
        const currentLangValue = normalized[locale];
        if (currentLangValue !== undefined && currentLangValue !== rawValue) {
          setValue(fieldPath, currentLangValue as PathValue<T, Path<T>>, {
            shouldDirty: false,
            shouldTouch: false,
            shouldValidate: false,
          });
        }
      }

      // 安全地获取字符串值，处理 File 对象和其他类型
      const getSafeStringValue = (val: any): string => {
        if (val === null || val === undefined) return "";
        if (typeof val === "string") return val;
        if (val instanceof File || (val as any) instanceof File)
          return val.name || "";
        if (typeof val === "object") {
          // 如果是多语言对象，返回当前语言的值
          const normalized = normalizeLocalizedValue(val);
          return normalized[locale] || "";
        }
        return String(val);
      };

      return {
        value: getSafeStringValue(rawValue),
        onChange: (value: any) => {
          // 立即更新表单
          setValue(fieldPath, value as PathValue<T, Path<T>>, {
            shouldDirty: true,
            shouldTouch: true,
            shouldValidate: true,
          });

          // 防抖同步到存储
          synchronizer.debouncedSync(fieldKey, value, locale, availableLocales);
        },
        name: fieldKey,
      };
    },
    [watch, setValue, locale, availableLocales, synchronizer],
  );

  const getFullLocalizedValue = useCallback(
    (fieldName: keyof T): Record<string, string> => {
      const fieldKey = String(fieldName);
      const allValues = synchronizer.getFieldAllLocales(fieldKey);

      // 确保所有可用语言都有值
      const result: Record<string, string> = { ...allValues };

      availableLocales.forEach((lang) => {
        if (result[lang] === undefined) {
          result[lang] = "";
        }
      });

      return result;
    },
    [availableLocales, synchronizer],
  );

  const switchLocale = useCallback(
    (newLocale: string) => {
      // 保存当前语言的值
      const allFields = synchronizer.getAllFieldNames();

      allFields.forEach((fieldName) => {
        const currentValue = getValues(fieldName as Path<T>);
        synchronizer.setFieldValue(fieldName, locale, currentValue);
      });

      // 切换到新语言
      prevLocaleRef.current = newLocale;

      // 更新语言后，需要外部调用者更新locale prop
      // 这里只返回新语言，由调用者处理
      return newLocale;
    },
    [locale, getValues, synchronizer],
  );

  const getSynchronizer = useCallback(() => synchronizer, [synchronizer]);

  const exportLocalizedData = useCallback(() => {
    return synchronizer.exportData();
  }, [synchronizer]);

  const importLocalizedData = useCallback(
    (data: Record<string, Record<string, string>>) => {
      synchronizer.importData(data);

      // 导入后，设置当前语言的值到表单
      Object.entries(data).forEach(([fieldName, localeValues]) => {
        const currentValue = localeValues[locale];
        if (currentValue !== undefined) {
          setValue(
            fieldName as Path<T>,
            currentValue as PathValue<T, Path<T>>,
            {
              shouldDirty: false,
              shouldTouch: false,
              shouldValidate: false,
            },
          );
        }
      });
    },
    [locale, setValue, synchronizer],
  );

  return useMemo(
    () => ({
      localize,
      getFullLocalizedValue,
      switchLocale,
      getSynchronizer,
      exportLocalizedData,
      importLocalizedData,
    }),
    [
      localize,
      getFullLocalizedValue,
      switchLocale,
      getSynchronizer,
      exportLocalizedData,
      importLocalizedData,
    ],
  );
}

/**
 * 创建多语言表单的默认配置
 * 注意：这个函数返回的配置对象包含 form 对象，可能会触发 TS71007 错误
 * 建议直接使用 useLocalizedFormV2 的参数形式
 * 已更新为接收扁平化参数，避免 TS71007 错误
 */
export function createLocalizedFormConfig<T extends FieldValues>(
  watch: UseFormWatch<T>,
  setValue: UseFormSetValue<T>,
  getValues: UseFormGetValues<T>,
  locale: string,
  availableLocales: string[] = [],
) {
  return {
    watch,
    setValue,
    getValues,
    locale,
    availableLocales,
  };
}
