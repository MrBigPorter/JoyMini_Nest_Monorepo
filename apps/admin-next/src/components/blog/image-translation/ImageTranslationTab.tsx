'use client';

import { useState, useRef, useCallback } from 'react';
import { ImageTranslationEngine, TextBox } from './ImageTranslationEngine';

interface ImageTranslationTabProps {
  onImport: (html: string) => void;
  isZh: boolean;
}

export function ImageTranslationTab({
  onImport,
  isZh,
}: ImageTranslationTabProps) {
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [translatedImage, setTranslatedImage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<TextBox[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const engine = new ImageTranslationEngine(
    process.env.NEXT_PUBLIC_GEMINI_API_KEY || '',
  );

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        setError(isZh ? '请选择图片文件' : 'Please select an image file');
        return;
      }

      setIsLoading(true);
      setError(null);
      setProgress(10);

      try {
        const reader = new FileReader();
        reader.onload = async (e) => {
          const dataUrl = e.target?.result as string;
          setOriginalImage(dataUrl);
          setProgress(30);

          const result = await engine.translateImage(dataUrl);
          setProgress(70);

          if (!result.success) {
            throw new Error(result.error);
          }

          setBoxes(result.boxes);

          const img = new Image();
          img.onload = async () => {
            const translated = await engine.renderTranslatedImage(
              img,
              result.boxes,
            );
            setTranslatedImage(translated);
            setProgress(100);
            setIsLoading(false);
          };
          img.src = dataUrl;
        };
        reader.readAsDataURL(file);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Translation failed');
        setIsLoading(false);
        setProgress(0);
      }
    },
    [isZh, engine],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const file = e.dataTransfer.files[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.startsWith('image/')) {
            const file = items[i].getAsFile();
            if (file) {
              handleFile(file);
            }
            break;
          }
        }
      }
    },
    [handleFile],
  );

  const handleInsert = useCallback(() => {
    if (translatedImage) {
      onImport(`<img src="${translatedImage}" alt="Translated image" />`);
    }
  }, [translatedImage, onImport]);

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* 原图区域 */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {isZh ? '原始图片' : 'Original Image'}
        </label>

        <div
          ref={dropZoneRef}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onPaste={handlePaste}
          className="w-full h-[360px] border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg flex items-center justify-center bg-gray-50 dark:bg-black/20 hover:border-primary-500 transition-colors cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
        >
          {originalImage ? (
            <img
              src={originalImage}
              className="max-w-full max-h-full object-contain p-2"
              alt="Original"
            />
          ) : (
            <div className="text-center text-gray-500 dark:text-gray-400">
              <div className="text-3xl mb-2">📷</div>
              <p className="text-sm">
                {isZh
                  ? '拖拽、粘贴或点击上传图片'
                  : 'Drop, paste or click to upload image'}
              </p>
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </div>

      {/* 翻译后区域 */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {isZh ? '翻译后图片' : 'Translated Image'}
        </label>

        <div className="w-full h-[360px] border border-gray-200 dark:border-white/10 rounded-lg flex items-center justify-center bg-white dark:bg-black/20">
          {isLoading ? (
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {isZh
                  ? `翻译中... ${progress}%`
                  : `Translating... ${progress}%`}
              </p>
            </div>
          ) : translatedImage ? (
            <img
              src={translatedImage}
              className="max-w-full max-h-full object-contain p-2"
              alt="Translated"
            />
          ) : (
            <div className="text-center text-gray-400 dark:text-gray-500">
              <div className="text-3xl mb-2">⏳</div>
              <p className="text-sm">
                {isZh ? '等待翻译' : 'Waiting for translation'}
              </p>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="col-span-2 flex items-center gap-2 text-sm text-red-600 dark:text-red-400 mt-2">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clipRule="evenodd"
            />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {translatedImage && (
        <div className="col-span-2 flex justify-end mt-2">
          <button
            type="button"
            onClick={handleInsert}
            className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors text-sm font-medium"
          >
            {isZh ? '插入到文章' : 'Insert into article'}
          </button>
        </div>
      )}
    </div>
  );
}
