'use client';

import React, { useState, useEffect } from 'react';
import { Modal, Button } from '@/components/UIComponents';
import { RichTextEditor } from '@/components/blog/RichTextEditor';
import { useRequest } from 'ahooks';
import { type Locale } from '@lucky/shared';
import { Bot } from 'lucide-react';

interface LocalizedFieldEditorProps {
  isOpen: boolean;
  onCloseAction: () => void;
  sourceLocale: Locale;
  targetLocale: Locale;
  sourceValue: string;
  currentValue: string;
  fieldType: 'text' | 'textarea' | 'richtext';
  label: string;
  onSaveAction: (value: string) => void;
}

export const LocalizedFieldEditor: React.FC<LocalizedFieldEditorProps> = ({
  isOpen,
  onCloseAction,
  sourceLocale,
  targetLocale,
  sourceValue,
  currentValue,
  fieldType,
  label,
  onSaveAction,
}) => {
  const [value, setValue] = useState(currentValue);

  // 每次打开重置状态
  useEffect(() => {
    if (isOpen) {
      setValue(currentValue);
    }
  }, [isOpen, currentValue]);

  // TODO: AI 翻译接口等待后端导出
  const { run: translate, loading: isTranslating } = useRequest(
    async () => {
      // 临时模拟，等 aiApi 导出后替换
      setValue(`[${targetLocale}] ${sourceValue}`);
      return;
    },
    { manual: true },
  );

  const handleSave = () => {
    onSaveAction(value);
    onCloseAction();
  };

  const LOCALE_NAMES: Record<Locale, { native: string; flag: string }> = {
    zh: { native: '简体中文', flag: '🇨🇳' },
    en: { native: 'English', flag: '🇺🇸' },
    ja: { native: '日本語', flag: '🇯🇵' },
    ko: { native: '한국어', flag: '🇰🇷' },
    fr: { native: 'Français', flag: '🇫🇷' },
    de: { native: 'Deutsch', flag: '🇩🇪' },
  };

  return (
    <Modal
      isOpen={isOpen}
      onCloseAction={onCloseAction}
      title={`🌐 ${LOCALE_NAMES[targetLocale].native} 翻译`}
      size="lg"
    >
      <div className="space-y-6 h-[550px] overflow-y-auto px-1 scrollbar-thin scrollbar-thumb-gray-200">
        <div className="grid grid-cols-2 gap-6">
          {/* 原文 */}
          <div className="space-y-4 p-4 border rounded-lg shadow-sm bg-gray-50/50">
            <h3 className="font-semibold text-sm text-gray-900 flex items-center gap-2">
              {LOCALE_NAMES[sourceLocale].flag} 原文
            </h3>
            <div className="p-3 rounded-md border border-gray-200 min-h-[280px] whitespace-pre-wrap text-sm">
              {sourceValue || '(空)'}
            </div>
          </div>

          {/* 译文 */}
          <div className="space-y-4 p-4 border rounded-lg shadow-sm bg-blue-50/30 border-blue-100">
            <h3 className="font-semibold text-sm text-blue-800 flex items-center gap-2">
              {LOCALE_NAMES[targetLocale].flag} 译文
            </h3>

            {fieldType === 'text' && (
              <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="请输入翻译内容"
                className="w-full px-3 py-2 border border-gray-200 rounded-md  outline-none focus:ring-0 focus:border-blue-400"
              />
            )}

            {fieldType === 'textarea' && (
              <textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                rows={12}
                placeholder="请输入翻译内容"
                className="w-full px-3 py-2 border border-gray-200 rounded-md min-h-[220px] outline-none focus:ring-0 focus:border-blue-400"
              />
            )}

            {fieldType === 'richtext' && (
              <div className="bg-white rounded-md border border-gray-200 overflow-hidden">
                <RichTextEditor
                  value={value}
                  onChangeAction={setValue}
                  placeholder="请输入翻译内容"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="pt-4 flex justify-end gap-3 sticky bottom-0 backdrop-blur-sm z-10 py-4 border-t border-gray-100">
        <Button
          type="button"
          variant="outline"
          onClick={translate}
          isLoading={isTranslating}
        >
          <Bot size={16} className="mr-1" />
          一键翻译
        </Button>
        <Button type="button" variant="outline" onClick={onCloseAction}>
          取消
        </Button>
        <Button type="button" onClick={handleSave} isLoading={isTranslating}>
          💾 保存
        </Button>
      </div>
    </Modal>
  );
};

export default LocalizedFieldEditor;
