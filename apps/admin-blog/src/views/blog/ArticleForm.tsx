"use client";

import React, {
  forwardRef,
  useImperativeHandle,
  useEffect,
  useRef,
} from "react";
import {
  Form,
  FormTextField,
  FormTextareaField,
  FormMediaUploaderField,
} from "@repo/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { RichTextEditor } from "@/components/blog/RichTextEditor";
import { SmartImage } from "@/components/ui/SmartImage";
import { Info } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";

const formSchema = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().min(1, "Content is required"),
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
  onFieldChange?: (field: string, value: string) => void; // 新增：字段变化回调
}

// 辅助函数：安全提取字符串值（支持多语言对象 -> 返回指定 locale 的值）
function extractStringValue(value: any, locale = "zh"): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    // 如果是多语言对象，返回指定语言的值或常见回退
    return value[locale] || value["zh"] || value["en"] || "";
  }
  return "";
}

// 辅助函数：检查是否为File对象
function isFile(value: any): value is File {
  return value instanceof File;
}

export const ArticleForm = forwardRef<ArticleFormRef, ArticleFormProps>(
  ({ onUpload, locale = "zh", isLocalized = false, onFieldChange }, ref) => {
    const { t: globalT } = useTranslation();
    const t = (key: string, params?: Record<string, string | number>) =>
      globalT(`blog_articleForm_${key}`, params);

    // 标记是否正在 reset 中，防止 reset 触发 watch 回调污染父表单
    const isResetting = useRef(false);

    const form = useForm<ArticleFormValues>({
      resolver: zodResolver(formSchema),
      defaultValues: {
        title: "",
        content: "",
        excerpt: "",
        featuredImage: "",
      },
    });

    const { control, watch, setValue, formState } = form;
    const { errors } = formState;

    // 监听表单变化并更新父表单
    useEffect(() => {
      const subscription = watch((value, { name }) => {
        if (name) {
          // 跳过 reset 期间的变化，避免污染父表单的多语言内容
          if (isResetting.current) return;

          // 这里可以添加逻辑来通知父表单更新
          // 使用类型安全的访问方式
          if (
            name === "title" ||
            name === "content" ||
            name === "excerpt" ||
            name === "featuredImage"
          ) {
            const fieldValue = value[name];
            console.log(`ArticleForm field changed: ${name} =`, fieldValue);

            // 调用回调函数通知父组件
            if (onFieldChange && fieldValue !== undefined) {
              onFieldChange(name, fieldValue);
            }
          }
        }
      });
      return () => subscription.unsubscribe();
    }, [watch, onFieldChange]);

    useImperativeHandle(ref, () => ({
      getValues: () => {
        const values = form.getValues();
        // 确保返回的是字符串值（支持多语言对象）
        return {
          title: extractStringValue(values.title, locale),
          content: extractStringValue(values.content, locale),
          excerpt: extractStringValue(values.excerpt, locale),
          featuredImage: extractStringValue(values.featuredImage, locale),
        };
      },
      reset: (values) => {
        // 标记 reset 中，阻止 watch 回调传播到父表单
        isResetting.current = true;

        // 安全处理：如果是对象，提取当前语言的值
        const safeValues = {
          title: extractStringValue(values?.title, locale),
          content: extractStringValue(values?.content, locale),
          excerpt: extractStringValue(values?.excerpt, locale),
          featuredImage: extractStringValue(values?.featuredImage, locale),
        };
        form.reset(safeValues);

        // 下一帧恢复，确保所有 watch 回调已处理完毕
        requestAnimationFrame(() => {
          isResetting.current = false;
        });
      },
    }));

    return (
      <Form {...form}>
        <div className="space-y-6">
          <FormTextField
            name="title"
            label={t("title")}
            placeholder={t("titlePlaceholder")}
            required
          />

          <div>
            <label className="block text-sm font-medium mb-2">
              {t("content")}
            </label>
            <RichTextEditor
              value={watch("content")}
              onChange={(value) =>
                setValue("content", value, {
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
            label={t("excerpt")}
            placeholder={t("excerptPlaceholder")}
          />

          <div className="p-4 rounded-lg shadow-sm">
            <FormMediaUploaderField
              name="featuredImage"
              label={t("featuredImage")}
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
              <Info size={12} /> {t("recommendedSize")}
            </p>
          </div>
        </div>
      </Form>
    );
  },
);

ArticleForm.displayName = "ArticleForm";
