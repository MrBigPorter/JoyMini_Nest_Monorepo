import { useForm, DefaultValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCallback } from 'react';
import { useToastStore } from '@/store/useToastStore';

type UseBlogFormOptions<T extends z.ZodSchema> = {
  schema: T;
  defaultValues?: DefaultValues<z.infer<T>>;
  onSubmit: (data: z.infer<T>) => Promise<void> | void;
};

/**
 * 博客系统通用的表单钩子，集成了 Zod 验证和 toast 错误提示。
 */
export function useBlogForm<T extends z.ZodSchema>({
  schema,
  defaultValues,
  onSubmit,
}: UseBlogFormOptions<T>) {
  const addToast = useToastStore((state) => state.addToast);

  const form = useForm<z.infer<T>>({
    resolver: zodResolver(schema as any),
    defaultValues,
  });

  const handleSubmit = useCallback(
    async (data: z.infer<T>) => {
      try {
        await onSubmit(data);
      } catch (error: unknown) {
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
    [onSubmit, addToast],
  );

  const submitHandler = form.handleSubmit(handleSubmit);

  return {
    ...form,
    submitHandler,
    isLoading: form.formState.isSubmitting,
    errors: form.formState.errors,
  };
}
