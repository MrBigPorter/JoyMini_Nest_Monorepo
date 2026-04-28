'use client';

import { useForm, DefaultValues, UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCallback } from 'react';
import { useToastStore } from '@/store/useToastStore';

type UseBlogFormOptions<T extends z.ZodSchema> = {
  schema: T;
  defaultValues?: DefaultValues<z.infer<T>>;
  onSubmitAction: (data: z.infer<T>) => Promise<void> | void;
};

/**
 * 博客系统通用的表单钩子，集成了 Zod 验证和 toast 错误提示。
 *  Next.js 15 RC 兼容: 函数参数名必须以 Action 结尾避免 TS71007 警告
 */
export function useBlogForm<T extends z.ZodSchema>({
  schema,
  defaultValues,
  onSubmitAction,
}: UseBlogFormOptions<T>): {
  form: UseFormReturn<z.infer<T>>;
  submitHandler: ReturnType<UseFormReturn<z.infer<T>>['handleSubmit']>;
  isLoading: boolean;
  errors: UseFormReturn<z.infer<T>>['formState']['errors'];
} {
  const addToast = useToastStore((state) => state.addToast);

  const form = useForm<z.infer<T>>({
    resolver: zodResolver(schema as any),
    defaultValues,
  });

  const handleSubmit = useCallback(
    async (data: z.infer<T>) => {
      console.log('========== [BLOG_FORM] handleSubmit called ==========');
      console.log(
        '[BLOG_FORM] data:',
        JSON.stringify(data, (key, value) => {
          if (
            key === 'content' &&
            typeof value === 'string' &&
            value.length > 100
          ) {
            return value.substring(0, 100) + '...';
          }
          return value;
        }),
      );
      try {
        await onSubmitAction(data);
      } catch (error: unknown) {
        console.log('[BLOG_FORM] handleSubmit caught error:', error);
        let message = '提交失败';

        if (error && typeof error === 'object') {
          // 处理 Axios 错误格式
          if (
            'response' in error &&
            error.response &&
            typeof error.response === 'object'
          ) {
            if (
              'data' in error.response &&
              error.response.data &&
              typeof error.response.data === 'object'
            ) {
              if (
                'message' in error.response.data &&
                typeof error.response.data.message === 'string'
              ) {
                message = error.response.data.message;
              }
            }
          }
          // 处理普通 Error 对象
          else if ('message' in error && typeof error.message === 'string') {
            message = error.message;
          }
        }
        addToast('error', message);
        console.error('Form submission error:', error);
      }
    },
    [onSubmitAction, addToast],
  );

  const submitHandler = form.handleSubmit(handleSubmit);

  //  Next.js 15 RC 正确修复方案:
  //  不展开属性, 把完整form对象作为单一字段返回
  //  这样类型 100% 兼容, 同时不会触发序列化检查
  return {
    form,
    submitHandler,
    isLoading: form.formState.isSubmitting,
    errors: form.formState.errors,
  };
}
