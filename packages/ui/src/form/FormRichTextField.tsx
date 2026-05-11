"use client";
// react-quill-new 在模块初始化时访问 document/window，不支持 SSR。
// 用 useEffect 懒加载，避免 Server Component 渲染时崩溃。
// 这是标准的 SSR-safe editor 处理方式（next-themes, shadcn/ui 等均用此模式）。
import { useMemo, useRef, useCallback, useState, useEffect } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { twMerge } from "tailwind-merge";
import type ReactQuillType from "react-quill-new";

interface FormRichTextFieldProps {
  name: string;
  label?: string;
  placeholder?: string;
  required?: boolean;
  className?: string;
  //必须传入一个上传函数
  // 接收 File，返回 Promise<string> (即图片URL)
  onUpload?: (file: File) => Promise<string>;
}

export const FormRichTextField = ({
  name,
  label,
  placeholder,
  required,
  className,
  onUpload,
}: FormRichTextFieldProps) => {
  const { control } = useFormContext();
  // 懒加载 ReactQuill：useEffect 只在客户端执行，避免 SSR 崩溃
  const [ReactQuill, setReactQuill] = useState<typeof ReactQuillType | null>(
    null,
  );
  const quillRef = useRef<ReactQuillType>(null);

  useEffect(() => {
    import("react-quill-new").then((mod) => setReactQuill(() => mod.default));
  }, []);

  // 自定义图片处理逻辑
  const imageHandler = useCallback(() => {
    // 1. 如果没传 onUpload 方法，就报错或者什么都不做
    if (!onUpload) {
      alert("Image upload configuration is missing!");
      return;
    }

    const input = document.createElement("input");
    input.setAttribute("type", "file");
    input.setAttribute("accept", "image/*");
    input.click();

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      // 简单的大小检查，也可以移到外面去
      if (file.size > 5 * 1024 * 1024) {
        alert("Image too large (max 5MB)");
        return;
      }

      try {
        //  2. 调用父组件传进来的方法
        // 组件只管拿 URL，不管你是调 API 还是上传到 AWS
        const url = await onUpload(file);

        const quill = quillRef.current?.getEditor();
        if (quill) {
          const range = quill.getSelection(true);
          quill.insertEmbed(range.index, "image", url);
          quill.setSelection(range.index + 1, 0);
        }
      } catch (error) {
        console.error("Upload failed in component:", error);
        alert("Failed to upload image");
      }
    };
  }, [onUpload]);

  const modules = useMemo(
    () => ({
      toolbar: {
        container: [
          [{ header: [1, 2, false] }],
          ["bold", "italic", "underline", "strike"],
          [{ list: "ordered" }, { list: "bullet" }],
          ["link", "image"],
          ["clean"],
        ],
        handlers: {
          image: imageHandler, // 绑定处理器
        },
      },
    }),
    [imageHandler],
  );

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => (
        <div className={twMerge("w-full flex flex-col gap-1.5", className)}>
          {label && (
            <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {label} {required && <span className="text-red-500">*</span>}
            </label>
          )}

          <div
            className={twMerge(
              "group flex flex-col bg-gray-50 dark:bg-black/20 border rounded-lg overflow-hidden transition-all",
              error ? "border-red-500" : "border-gray-200 dark:border-gray-800",
            )}
          >
            {/* ReactQuill 未加载前显示骨架屏占位 — 模拟工具栏+编辑区布局，防止布局跳跃 */}
            {!ReactQuill ? (
              <div className="flex flex-col rounded overflow-hidden">
                {/* 模拟工具栏 */}
                <div className="h-[42px] bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center gap-1 px-2">
                  {[...Array(8)].map((_, i) => (
                    <div
                      key={i}
                      className="h-5 w-5 bg-gray-200 dark:bg-gray-700 animate-pulse rounded"
                    />
                  ))}
                </div>
                {/* 模拟编辑区 */}
                <div className="h-[298px] bg-gray-50 dark:bg-gray-800/50 animate-pulse" />
              </div>
            ) : (
              <ReactQuill
                ref={quillRef}
                theme="snow"
                value={field.value || ""}
                onChange={field.onChange}
                placeholder={placeholder}
                modules={modules}
                style={{
                  height: "300px",
                  display: "flex",
                  flexDirection: "column",
                }}
                className="flex-1"
              />
            )}
          </div>

          {error && (
            <span className="text-xs text-red-500">{error.message}</span>
          )}
        </div>
      )}
    />
  );
};
