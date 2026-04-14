'use client';

import React, { forwardRef, useImperativeHandle } from 'react';
import {
  Form,
  FormTextField,
  FormTextareaField,
  FormMediaUploaderField,
} from '@repo/ui/form';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { RichTextEditor } from '@/components/blog/RichTextEditor';
import { SmartImage } from '@/components/ui/SmartImage';
import { Info } from 'lucide-react';

const formSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  content: z.string().min(1, 'Content is required'),
  excerpt: z.string().optional(),
  featuredImage: z.any().optional(),
});

export type ArticleFormValues = z.infer<typeof formSchema>;

export interface ArticleFormRef {
  getValues: () => ArticleFormValues;
  reset: (values: Partial<ArticleFormValues>) => void;
}

interface ArticleFormProps {
  onUpload?: (file: File) => Promise<string>;
  locale?: string; // 可选：当前语言
  isLocalized?: boolean; // 可选：是否多语言模式
}

// 辅助函数：安全提取字符串值
function extractStringValue(value: any): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    // 如果是多语言对象，返回空字符串（由父组件处理）
    return '';
  }
  return '';
}

export const ArticleForm = forwardRef<ArticleFormRef, ArticleFormProps>(
  ({ onUpload, locale = 'zh', isLocalized = false }, ref) => {
    const form = useForm<ArticleFormValues>({
      resolver: zodResolver(formSchema),
      defaultValues: {
        title: '',
        content: '',
        excerpt: '',
        featuredImage: '',
      },
    });

    const { control, watch, setValue, formState } = form;
    const { errors } = formState;

    useImperativeHandle(ref, () => ({
      getValues: () => {
        const values = form.getValues();
        // 确保返回的是字符串值
        return {
          title: typeof values.title === 'string' ? values.title : '',
          content: typeof values.content === 'string' ? values.content : '',
          excerpt: typeof values.excerpt === 'string' ? values.excerpt : '',
          featuredImage:
            typeof values.featuredImage === 'string'
              ? values.featuredImage
              : '',
        };
      },
      reset: (values) => {
        // 安全处理：如果是对象，提取当前语言的值
        const safeValues = {
          title: extractStringValue(values?.title),
          content: extractStringValue(values?.content),
          excerpt: extractStringValue(values?.excerpt),
          featuredImage: extractStringValue(values?.featuredImage),
        };
        form.reset(safeValues);
      },
    }));

    return (
      <Form {...form}>
        <div className="space-y-6">
          <FormTextField
            name="title"
            label="Title"
            placeholder="Enter article title"
            required
          />

          <div>
            <label className="block text-sm font-medium mb-2">Content</label>
            <RichTextEditor
              value={watch('content')}
              onChange={(value) =>
                setValue('content', value, {
                  shouldDirty: true,
                  shouldTouch: true,
                })
              }
              onUpload={onUpload}
            />
            {errors.content && (
              <p className="text-red-500 text-sm mt-1">
                {errors.content.message}
              </p>
            )}
          </div>

          <FormTextareaField
            name="excerpt"
            label="Excerpt"
            placeholder="Brief summary of the article"
          />

          <div className="p-4 rounded-lg shadow-sm">
            <FormMediaUploaderField
              name="featuredImage"
              label="Featured Image"
              maxFileCount={1}
              renderImage={({ src, alt, className }) => (
                <SmartImage
                  src={src}
                  alt={alt}
                  width={400}
                  height={400}
                  className={className}
                  imgClassName="w-64 h-64 rounded-md object-cover"
                  layout="constrained"
                />
              )}
            />
            <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
              <Info size={12} /> Recommended 800x800px
            </p>
          </div>
        </div>
      </Form>
    );
  },
);

ArticleForm.displayName = 'ArticleForm';
