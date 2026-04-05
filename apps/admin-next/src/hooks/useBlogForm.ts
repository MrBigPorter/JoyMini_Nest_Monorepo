import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCallback } from 'react';
import { useToastStore } from '@/store/useToastStore';

type UseBlogFormOptions<T extends z.ZodType<any, any>> = {
  schema: T;
  defaultValues?: Partial<z.infer<T>>;
  onSubmit: (data: z.infer<T>) => Promise<void> | void;
};

/**
 * 博客系统通用的表单钩子，集成了 Zod 验证和 toast 错误提示。
 */
export function useBlogForm<T extends z.ZodType<any, any>>({
  schema,
  defaultValues,
  onSubmit,
}: UseBlogFormOptions<T>) {
  const addToast = useToastStore((state) => state.addToast);

  const form = useForm<z.infer<T>>({
    resolver: zodResolver(schema as any),
    defaultValues: defaultValues as any,
  });

  const handleSubmit = useCallback(
    async (data: z.infer<T>) => {
      try {
        await onSubmit(data);
      } catch (error: any) {
        const message =
          error?.response?.data?.message || error?.message || '提交失败';
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
