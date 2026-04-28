'use client';

import { useState, useCallback } from 'react';
import { ModalFixed } from '@repo/ui/components/Modal/ModalFixed';
import { Marked } from 'marked';

const marked = new Marked({
  gfm: true,
  breaks: true,
  silent: true,
});

interface MarkdownImportModalProps {
  onImportAction: (html: string) => void;
  onCloseAction: () => void;
}

// 多语言文本
const i18n = {
  title: {
    zh: '导入 Markdown',
    en: 'Import Markdown',
  },
  description: {
    zh: '粘贴 Markdown 内容，将自动转换为富文本格式',
    en: 'Paste Markdown content, it will be automatically converted to rich text format',
  },
  sourceLabel: {
    zh: 'Markdown 源码',
    en: 'Markdown Source',
  },
  previewLabel: {
    zh: '实时预览',
    en: 'Live Preview',
  },
  placeholder: {
    zh: '在此粘贴 Markdown 内容...',
    en: 'Paste your Markdown content here...',
  },
  errorParse: {
    zh: 'Markdown 解析失败，请检查格式',
    en: 'Markdown parse failed, please check the format',
  },
  errorEmpty: {
    zh: '请输入 Markdown 内容',
    en: 'Please enter Markdown content',
  },
  confirm: {
    zh: '导入',
    en: 'Import',
  },
  cancel: {
    zh: '取消',
    en: 'Cancel',
  },
};

export function MarkdownImportModal({
  onImportAction,
  onCloseAction,
}: MarkdownImportModalProps) {
  const [activeTab, setActiveTab] = useState<'markdown'>('markdown');
  const [markdown, setMarkdown] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');

  // 自动检测浏览器语言，未来替换为系统i18n hook
  const isZh =
    typeof navigator !== 'undefined' && navigator.language.startsWith('zh');
  const t = useCallback(
    (key: keyof typeof i18n) => i18n[key][isZh ? 'zh' : 'en'],
    [isZh],
  );

  const handleMarkdownChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setMarkdown(value);
      setError(null);

      try {
        if (value.trim()) {
          const html = marked.parse(value) as string;
          setPreviewHtml(html);
        } else {
          setPreviewHtml('');
        }
      } catch (err) {
        setError(t('errorParse'));
        setPreviewHtml('');
      }
    },
    [t],
  );

  const handleConfirm = useCallback(() => {
    if (!markdown.trim()) {
      setError(t('errorEmpty'));
      return;
    }

    try {
      const html = marked.parse(markdown) as string;

      onImportAction(html);
      onCloseAction();
    } catch (err) {
      setError(t('errorParse'));
    }
  }, [markdown, onImportAction, onCloseAction, t]);

  return (
    <ModalFixed
      title={t('title')}
      size="xxl"
      confirmText={t('confirm')}
      cancelText={t('cancel')}
      onCancel={onCloseAction}
      onConfirm={handleConfirm}
      enableClickOutsideClose={false}
      renderChildren={() => (
        <div className="flex flex-col gap-4">
          {activeTab === 'markdown' && (
            <>
              <div className="grid grid-cols-2 gap-4 mt-2">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('sourceLabel')}
                  </label>
                  <textarea
                    value={markdown}
                    onChange={handleMarkdownChange}
                    placeholder={t('placeholder')}
                    className="w-full h-[400px] p-3 font-mono text-sm bg-gray-50 dark:bg-black/30 border border-gray-200 dark:border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 resize-none"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('previewLabel')}
                  </label>
                  <div
                    className="w-full h-[400px] p-3 bg-white dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-lg overflow-y-auto prose dark:prose-invert prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 mt-2">
                  <svg
                    className="w-4 h-4"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span>{error}</span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    />
  );
}
