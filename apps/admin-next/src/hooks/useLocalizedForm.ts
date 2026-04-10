'use client';

import { useCallback } from 'react';
import {
  FieldValues,
  FieldErrors,
  UseFormWatch,
  UseFormSetValue,
} from 'react-hook-form';

interface UseLocalizedFormOptions<T extends FieldValues> {
  watch: UseFormWatch<T>;
  setValue: UseFormSetValue<T>;
  errors: FieldErrors<T>;
  locale: string;
}

/**
 * ✅ Next.js 15 RC 正确写法: 永远不要接收整个form对象!
 * ✅ 只接收需要的单个函数, 永远不要把完整UseFormReturn对象跨边界传递
 * ✅ 这样就永远不会触发 TS71007 警告
 */
export function useLocalizedForm<T extends FieldValues>({
  watch,
  setValue,
  errors,
  locale,
}: UseLocalizedFormOptions<T>) {
  const localize = useCallback(
    (fieldName: keyof T) => {
      const fieldPath = `${String(fieldName)}.${locale}`;

      return {
        // 自动获取当前语言的值
        value: watch(fieldPath as any) || '',

        // 自动写入当前语言的值
        onChangeAction: (value: any) => {
          setValue(fieldPath as any, value, {
            shouldDirty: true,
            shouldTouch: true,
          });
        },

        // 自动绑定表单错误
        error: errors[fieldName as keyof typeof errors]
          ? (errors[fieldName as keyof typeof errors] as any)?.[locale]
          : undefined,

        // 透传 name 属性
        name: fieldPath,
      };
    },
    [watch, setValue, errors, locale],
  );

  return {
    localize,
    locale,
  };
}

export default useLocalizedForm;
