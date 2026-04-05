'use client';

import { useMemo, useRef, useCallback, useState, useEffect } from 'react';
import type ReactQuillType from 'react-quill-new';
import './RichTextEditor.css';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  required?: boolean;
  error?: string;
  className?: string;
  onUpload?: (file: File) => Promise<string>;
}

export const RichTextEditor = ({
  value,
  onChange,
  placeholder,
  label,
  required,
  error,
  className,
  onUpload,
}: RichTextEditorProps) => {
  // 懒加载 ReactQuill：useEffect 只在客户端执行，避免 SSR 崩溃
  const [ReactQuill, setReactQuill] = useState<typeof ReactQuillType | null>(
    null,
  );
  const quillRef = useRef<ReactQuillType>(null);

  useEffect(() => {
    import('react-quill-new').then((mod) => setReactQuill(() => mod.default));
  }, []);

  // 自定义图片处理逻辑
  const imageHandler = useCallback(() => {
    // 1. 如果没传 onUpload 方法，就报错或者什么都不做
    if (!onUpload) {
      alert(
        'Image upload configuration is missing! Please implement onUpload prop.',
      );
      return;
    }

    const input = document.createElement('input');
    input.setAttribute('type', 'file');
    input.setAttribute('accept', 'image/*');
    input.click();

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      // 简单的大小检查
      if (file.size > 5 * 1024 * 1024) {
        alert('Image too large (max 5MB)');
        return;
      }

      try {
        // 2. 调用父组件传进来的方法
        const url = await onUpload(file);

        const quill = quillRef.current?.getEditor();
        if (quill) {
          const range = quill.getSelection(true);
          quill.insertEmbed(range.index, 'image', url);
          quill.setSelection(range.index + 1, 0);
        }
      } catch (error) {
        console.error('Upload failed in component:', error);
        alert('Failed to upload image');
      }
    };
  }, [onUpload]);

  const modules = useMemo(
    () => ({
      toolbar: {
        container: [
          [{ header: [1, 2, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['link', 'image'],
          ['clean'],
        ],
        handlers: {
          image: imageHandler, // 绑定处理器
        },
      },
    }),
    [imageHandler],
  );

  return (
    <div className={`w-full flex flex-col gap-3 ${className || ''}`}>
      {label && (
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {label} {required && <span className="text-red-500">*</span>}
          </label>
          {required && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Required
            </span>
          )}
        </div>
      )}

      <div
        className={`group flex flex-col bg-white dark:bg-black/30 border-2 rounded-xl overflow-hidden transition-all duration-300 shadow-sm hover:shadow-md ${
          error
            ? 'border-red-500 ring-2 ring-red-500/20'
            : 'border-gray-200 dark:border-white/10 hover:border-primary-400 dark:hover:border-primary-500 focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-500/30'
        }`}
      >
        {/* ReactQuill 未加载前显示骨架屏占位 */}
        {!ReactQuill ? (
          <div className="h-[340px] bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900 animate-pulse rounded-lg" />
        ) : (
          <ReactQuill
            ref={quillRef}
            theme="snow"
            value={value || ''}
            onChange={onChange}
            placeholder={placeholder}
            modules={modules}
            style={{
              height: '300px',
              display: 'flex',
              flexDirection: 'column',
            }}
            className="flex-1"
          />
        )}
      </div>

      {error && (
        <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
          <svg
            className="w-3.5 h-3.5"
            fill="currentColor"
            viewBox="0 0 20 20"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clipRule="evenodd"
            />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {!onUpload && (
        <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 mt-1">
          <svg
            className="w-3.5 h-3.5"
            fill="currentColor"
            viewBox="0 0 20 20"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <span>
            Note: Image upload is not configured. Please implement onUpload prop
            to enable image upload.
          </span>
        </div>
      )}
    </div>
  );
};
