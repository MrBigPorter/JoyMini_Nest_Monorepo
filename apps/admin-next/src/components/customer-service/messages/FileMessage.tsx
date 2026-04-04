'use client';

import { Download, FileText } from 'lucide-react';
import { resolveMediaUrl, formatFileSize } from '@/lib/media-utils';

export function FileMessage({
  content,
  meta,
  isSupport,
}: {
  content: string;
  meta: Record<string, unknown> | null;
  isSupport: boolean;
}) {
  const fileUrl = resolveMediaUrl(content);
  const fileName = (meta?.fileName as string) ?? 'file';
  const fileSize = meta?.fileSize as number | undefined;
  const fileExt = ((meta?.fileExt as string) ?? '').toUpperCase();

  return (
    <a
      href={fileUrl}
      download={fileName}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl w-52 group transition-colors ${
        isSupport
          ? 'bg-teal-600/80 hover:bg-teal-600 text-white'
          : 'bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/15 text-gray-900 dark:text-white'
      }`}
    >
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold ${
          isSupport
            ? 'bg-white/20'
            : 'bg-teal-100 dark:bg-teal-500/20 text-teal-600 dark:text-teal-400'
        }`}
      >
        {fileExt || <FileText size={16} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{fileName}</p>
        {fileSize && (
          <p
            className={`text-xs ${isSupport ? 'text-white/70' : 'text-gray-400'}`}
          >
            {formatFileSize(fileSize)}
          </p>
        )}
      </div>
      <Download
        size={14}
        className="flex-shrink-0 opacity-60 group-hover:opacity-100"
      />
    </a>
  );
}
