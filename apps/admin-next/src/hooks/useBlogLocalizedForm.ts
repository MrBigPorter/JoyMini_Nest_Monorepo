'use client';

import { useCallback, useMemo } from 'react';
import { z } from 'zod';
import { useLanguage } from '@/hooks/LanguageProvider';
import { useAvailableLocales } from '@/hooks/useAvailableLocales';
import { useLocalizedForm } from './useLocalizedForm';
import { useBlogForm } from './useBlogForm';
import type { Locale } from '@lucky/shared';

type UseBlogLocalizedFormOptions<T extends z.ZodSchema> = {
  schema: T;
  defaultValues?: any;
  onSubmitAction: (data: z.infer<T>) => Promise<void> | void;
};

/**
 * 博客系统统一的多语言表单钩子
 * 整合了 useBlogForm 和 useLocalizedForm，提供一致的多语言体验
 */
export function useBlogLocalizedForm<T extends z.ZodSchema>({
  schema,
  defaultValues,
  onSubmitAction,
}: UseBlogLocalizedFormOptions<T>) {
  const { locale, setLocale } = useLanguage();
  const { enabledLocales } = useAvailableLocales();

  // 获取所有可用的语言代码
  const availableLocaleCodes = useMemo(
    () => enabledLocales.map((l) => l.code as Locale),
    [enabledLocales],
  );

  // 使用博客表单钩子
  const blogForm = useBlogForm({
    schema,
    defaultValues,
    onSubmitAction,
  });

  const { form, submitHandler, isLoading } = blogForm;
  const { watch, setValue, formState } = form;
  const { errors } = formState;

  // 使用多语言表单钩子
  const { localize, getFullLocalizedValue } = useLocalizedForm({
    watch,
    setValue,
    errors,
    locale,
  });

  /**
   * 获取完整的多语言数据用于提交
   */
  const getFullLocalizedData = useCallback(() => {
    const data = form.getValues();
    const localizedFields = [
      'title',
      'content',
      'excerpt',
      'featuredImage',
      'name',
      'description',
      'reply',
    ];

    const result: any = { ...data };

    // 处理所有可能的多语言字段
    localizedFields.forEach((field) => {
      if (field in data) {
        result[field] = getFullLocalizedValue(
          field as any,
          availableLocaleCodes,
        );
      }
    });

    return result;
  }, [form, getFullLocalizedValue, availableLocaleCodes]);

  /**
   * 处理语言切换
   */
  const handleLocaleChange = useCallback(
    (newLocale: Locale) => {
      // 更新语言状态
      // useLocalizedForm 会自动处理表单字段的切换
      // 这里需要调用 setLocale 来更新全局语言状态
      if (newLocale !== locale) {
        setLocale(newLocale);
      }
    },
    [locale, setLocale],
  );

  return {
    // 表单相关
    form,
    submitHandler,
    isLoading,
    errors,

    // 多语言相关
    locale,
    availableLocaleCodes,
    localize,
    getFullLocalizedValue,
    getFullLocalizedData,
    handleLocaleChange,

    // 原始方法
    watch: form.watch,
    setValue: form.setValue,
    reset: form.reset,
    getValues: form.getValues,
  };
}

export default useBlogLocalizedForm;
