'use client';

import { useCallback } from 'react';
import { type UseFormReturn } from 'react-hook-form';
import { useLanguage } from './useLanguage';

/**
 * 多语言表单绑定 Hook
 * 写一次，整个系统所有表单通用
 * 零 if else，零三元表达式
 *
 * @example
 * ```tsx
 * const form = useForm()
 * const { localize } = useLocalizedForm(form)
 *
 * return <FormInput label="标题" {...localize('title')} />
 * ```
 */
export function useLocalizedForm<T extends Record<string, any>>(
  form: UseFormReturn<T>,
) {
  const { locale } = useLanguage();

  const localize = useCallback(
    (fieldName: keyof T) => {
      const fieldPath = `${String(fieldName)}.${locale}`;

      return {
        // 自动获取当前语言的值
        value: form.watch(fieldPath as any) || '',

        // 自动写入当前语言的值
        onChangeAction: (value: any) => {
          form.setValue(fieldPath as any, value, {
            shouldDirty: true,
            shouldTouch: true,
          });
        },

        // 自动绑定表单错误
        error: (
          form.formState.errors[
            fieldName as keyof typeof form.formState.errors
          ] as any
        )?.[locale],

        // 透传 name 属性
        name: fieldPath,
      };
    },
    [form, locale],
  );

  return {
    localize,
    locale,
  };
}

export default useLocalizedForm;
