'use client';

import { useMemo, useRef, useCallback, useState, useEffect } from 'react';
import type ReactQuillType from 'react-quill-new';
import { Marked } from 'marked';
import { MarkdownImportModal } from './MarkdownImportModal';
import { registerHtml5VideoBlot } from './Html5VideoBlot';
import './RichTextEditor.css';

const marked = new Marked({
  gfm: true,
  breaks: true,
  silent: true,
});

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  required?: boolean;
  error?: string;
  className?: string;
  onUpload?: (
    file: File,
    onProgress?: (pct: number) => void,
  ) => Promise<string>;
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
  // Ensure we only perform initial content sync once after editor mounts
  const hasInitialized = useRef(false);

  useEffect(() => {
    // Load Quill CSS dynamically only on client
    const loadCss = () => {
      // Check if already loaded to avoid duplicates
      if (!document.querySelector('link[href*="quill.snow.css"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href =
          'https://cdn.jsdelivr.net/npm/react-quill-new@3.2.0/dist/quill.snow.css';
        document.head.appendChild(link);
      }
    };

    import('react-quill-new').then((mod) => {
      const ReactQuillModule = mod.default;
      // Dynamic import creates a new Quill instance in Next.js chunk isolation.
      // We must register the blot on THIS instance too, otherwise <video> tags
      // will be silently dropped when parsing existing content.
      const DynamicQuill = (ReactQuillModule as any).Quill;
      if (DynamicQuill && !DynamicQuill.imports?.['formats/html5-video']) {
        registerHtml5VideoBlot(DynamicQuill);
      }

      loadCss();
      setReactQuill(() => ReactQuillModule);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only load Quill once on mount
  }, []);

  // When the ReactQuill module is ready, initialize editor content once to avoid
  // the initial onChange from the editor overwriting the incoming `value` prop.
  // Use a deferred attempt because ReactQuill's internal editor may not be
  // fully instantiated immediately at render time (calling getEditor too early
  // can throw). We only perform this once.
  useEffect(() => {
    if (!ReactQuill) return;
    if (hasInitialized.current) return;

    const attempt = () => {
      try {
        const quill =
          quillRef.current &&
          (quillRef.current as any).getEditor &&
          (quillRef.current as any).getEditor();
        if (!quill) {
          // Not ready yet — try again soon
          requestAnimationFrame(attempt);
          return;
        }

        // Only paste if value exists, otherwise ensure editor is empty
        try {
          if (value) {
            quill.clipboard.dangerouslyPasteHTML(value);
          } else {
            quill.setText('');
          }
        } catch (e) {
          console.warn('[RichTextEditor] initial paste failed', e);
        }
        hasInitialized.current = true;
      } catch (err) {
        // getEditor may throw if editor not instantiated; retry on next frame
        requestAnimationFrame(attempt);
      }
    };

    attempt();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: value is only used for initial paste, guarded by hasInitialized ref
  }, [ReactQuill]);

  //  不要自动监听 Quill 事件，因为会触发无限循环
  // ❌ 所有通过代码修改内容的地方我都会手动调用 onChange
  // 这是目前唯一不会死循环的正确方案

  const [showImportModal, setShowImportModal] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Markdown 导入处理器
  const markdownImportHandler = useCallback(() => {
    setShowImportModal(true);
  }, []);

  const handleImportMarkdown = useCallback(
    (html: string) => {
      const quill = quillRef.current?.getEditor();
      if (quill) {
        // 修复: 插入后必须手动触发 onChange 事件更新表单值
        quill.clipboard.dangerouslyPasteHTML(html);

        // 手动触发内容更新
        const content = quill.root.innerHTML;
        onChange(content);
      }
    },
    [onChange],
  );

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

      try {
        console.debug('[RichTextEditor] imageHandler: file selected', {
          name: file.name,
          size: file.size,
          type: file.type,
        });
        setIsUploading(true);

        setUploadProgress(0);
        const url = await onUpload(file, (pct) => setUploadProgress(pct));
        console.debug(
          '[RichTextEditor] imageHandler: upload finished, url=',
          url,
        );

        const quill = quillRef.current?.getEditor();
        if (quill) {
          // 修复: 如果没有选中位置默认在末尾插入
          let range = quill.getSelection();
          if (!range) {
            range = { index: quill.getLength(), length: 0 };
          }

          // Clamp the insert index to valid bounds (avoid out-of-range selection)
          const insertIndex = Math.max(
            0,
            Math.min(range.index, quill.getLength()),
          );
          console.debug('[RichTextEditor] imageHandler: inserting image', {
            insertIndex,
            length: quill.getLength(),
          });
          quill.insertEmbed(insertIndex, 'image', url, 'user');

          // After inserting, move caret to just after the embed but ensure index is valid
          const newIndex = Math.max(
            0,
            Math.min(insertIndex + 1, quill.getLength()),
          );
          try {
            quill.setSelection(newIndex, 0, 'user');
          } catch (e) {
            // setSelection may fail if DOM range is temporarily invalid — ignore safely
            console.warn(
              '[RichTextEditor] imageHandler: setSelection failed (ignored)',
              e,
            );
          }

          // 修复: 插入图片后手动触发 onChange 事件
          setTimeout(() => {
            const content = quill.root.innerHTML;
            console.debug(
              '[RichTextEditor] imageHandler: editor content after insert',
              { contentSnippet: content.slice(0, 200) },
            );
            onChange(content);
          }, 0);
        }
        setIsUploading(false);
      } catch (error) {
        setIsUploading(false);
        console.error('Upload failed in component:', error);
        alert('Failed to upload image');
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: onChange is a parent prop that may change every render; adding it could cause infinite loops
  }, [onUpload]);

  // 自定义视频上传处理逻辑
  const videoHandler = useCallback(() => {
    if (!onUpload) {
      alert(
        'Video upload configuration is missing! Please implement onUpload prop.',
      );
      return;
    }

    const input = document.createElement('input');
    input.setAttribute('type', 'file');
    input.setAttribute('accept', 'video/*');
    input.click();

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      try {
        console.debug('[RichTextEditor] videoHandler: file selected', {
          name: file.name,
          size: file.size,
          type: file.type,
        });
        setIsUploading(true);

        setUploadProgress(0);
        const url = await onUpload(file, (pct) => setUploadProgress(pct));
        console.debug(
          '[RichTextEditor] videoHandler: upload finished, url=',
          url,
        );

        const quill = quillRef.current?.getEditor();
        if (quill) {
          let range = quill.getSelection();
          if (!range) {
            range = { index: quill.getLength(), length: 0 };
          }

          // Clamp insert index to valid bounds
          const insertIndex = Math.max(
            0,
            Math.min(range.index, quill.getLength()),
          );
          console.debug('[RichTextEditor] videoHandler: inserting video', {
            insertIndex,
            length: quill.getLength(),
          });

          const beforeHtml = quill.root.innerHTML;

          // 如果当前 Quill 实例上没有注册 blot，尝试在该实例上注册一次
          try {
            const QuillCtor = quill.constructor as any;
            const isRegistered = QuillCtor?.imports?.['formats/html5-video'];
            console.debug(
              '[RichTextEditor] videoHandler: blot registered on editor?',
              !!isRegistered,
            );
            if (!isRegistered) {
              console.debug(
                '[RichTextEditor] videoHandler: registering Html5VideoBlot on editor Quill ctor',
              );
              try {
                registerHtml5VideoBlot(QuillCtor);
              } catch (e) {
                console.warn(
                  '[RichTextEditor] videoHandler: registerHtml5VideoBlot failed',
                  e,
                );
              }
            }
          } catch (e) {
            console.warn(
              '[RichTextEditor] videoHandler: checking/registering blot failed',
              e,
            );
          }

          // 使用自定义 Html5VideoBlot 插入 <video> 元素，确保编辑器内可见可播放
          // Pass source 'user' to ensure Quill treats this as a user action
          quill.insertEmbed(insertIndex, 'html5-video', url, 'user');

          // Move caret to just after the embed; clamp to avoid "range isn't in document"
          const newIndex = Math.max(
            0,
            Math.min(insertIndex + 1, quill.getLength()),
          );
          try {
            quill.setSelection(newIndex, 0, 'user');
          } catch (e) {
            console.warn(
              '[RichTextEditor] videoHandler: setSelection failed (ignored)',
              e,
            );
          }

          // 如果 insertEmbed 似乎没有改变 DOM（某些情况下 Quill 会丢弃未知 embed），作为回退直接 paste HTML
          setTimeout(() => {
            const afterHtml = quill.root.innerHTML;
            if (afterHtml === beforeHtml) {
              console.warn(
                '[RichTextEditor] videoHandler: insertEmbed did not change content, falling back to dangerouslyPasteHTML',
              );
              // 推断 mime
              const extMatch = String(url)
                .split('?')[0]
                .match(/\.([a-zA-Z0-9]+)$/);
              let mime = '';
              if (extMatch) {
                const ext = extMatch[1].toLowerCase();
                if (ext === 'mp4') mime = 'video/mp4';
                else if (ext === 'webm') mime = 'video/webm';
                else if (ext === 'ogg' || ext === 'ogv') mime = 'video/ogg';
              }

              const videoHtml = mime
                ? `<video controls class="w-full rounded-lg my-4"><source src="${url}" type="${mime}"></source></video>`
                : `<video controls class="w-full rounded-lg my-4" src="${url}"></video>`;

              try {
                quill.clipboard.dangerouslyPasteHTML(insertIndex, videoHtml);
              } catch (e) {
                console.error(
                  '[RichTextEditor] videoHandler: dangerouslyPasteHTML failed',
                  e,
                );
              }

              // ensure onChange sees the new content
              setTimeout(() => {
                const content = quill.root.innerHTML;
                console.debug(
                  '[RichTextEditor] videoHandler: editor content after fallback insert',
                  { contentSnippet: content.slice(0, 200) },
                );
                onChange(content);
              }, 0);
            } else {
              const content = afterHtml;
              console.debug(
                '[RichTextEditor] videoHandler: editor content after insert',
                { contentSnippet: content.slice(0, 200) },
              );
              onChange(content);
            }
          }, 0);
        }
        setIsUploading(false);
      } catch (error) {
        setIsUploading(false);
        console.error('Video upload failed:', error);
        alert('Failed to upload video');
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: onChange is a parent prop that may change every render; adding it could cause infinite loops
  }, [onUpload]);

  const modules = useMemo(
    () => ({
      toolbar: {
        container: [
          [{ header: [1, 2, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['link', 'image', 'video'],
          ['clean'],
          ['markdown'],
        ],
        handlers: {
          image: imageHandler,
          video: videoHandler,
          markdown: markdownImportHandler,
        },
      },
    }),
    [imageHandler, videoHandler, markdownImportHandler],
  );

  return (
    <>
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
              placeholder={placeholder}
              modules={modules}
              style={{
                height: '300px',
                display: 'flex',
                flexDirection: 'column',
              }}
              className="flex-1"
              onChange={(content, delta, source, editor) => {
                // ✅ 只传播用户操作，忽略程序化设置
                // value prop 变化导致的内容更新不应触发回调循环
                if (source !== 'user') return;

                // ✅ 最终正确方案：对比值，只有真实变更才回调
                setTimeout(() => {
                  const realHtml =
                    quillRef.current?.getEditor().root.innerHTML || '';

                  // ✅ 只有当内容真的不同的时候才向上更新，这是唯一能彻底避免所有问题的方法
                  if (realHtml !== value) {
                    onChange(realHtml);
                  }
                }, 0);
              }}
            />
          )}
        </div>

        {/* Upload loading indicator */}
        {isUploading && (
          <div className="flex items-center gap-2 px-1">
            <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap min-w-[4rem] text-right">
              {uploadProgress < 100
                ? `${Math.round(uploadProgress)}%`
                : 'Processing...'}
            </span>
          </div>
        )}

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
              Note: Image upload is not configured. Please implement onUpload
              prop to enable image upload.
            </span>
          </div>
        )}
      </div>
      {/* Markdown 导入对话框 */}
      {showImportModal && (
        <MarkdownImportModal
          onImport={handleImportMarkdown}
          onClose={() => setShowImportModal(false)}
        />
      )}
    </>
  );
};
