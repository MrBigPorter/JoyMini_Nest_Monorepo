/**
 * CDN 媒体 URL 工具函数
 */

const IMG_BASE_URL =
  process.env.NEXT_PUBLIC_IMG_BASE_URL ?? 'https://img.joyminis.com';

export function resolveMediaUrl(content: string): string {
  if (!content) return '';
  if (content.startsWith('https://') || content.startsWith('http://'))
    return content;
  if (content.startsWith('uploads/')) return `${IMG_BASE_URL}/${content}`;
  return `${IMG_BASE_URL}/${content.replace(/^\//, '')}`;
}

export function resolveImageUrl(content: string, width = 240): string {
  const base = resolveMediaUrl(content);
  if (!base || !base.includes('uploads/')) return base;
  const key = base.substring(base.indexOf('uploads/'));
  return `${IMG_BASE_URL}/cdn-cgi/image/width=${width},quality=75,fit=cover,f=auto/${key}`;
}

export function formatFileSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms?: number): string {
  if (!ms) return '0s';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/** 生成波形柱高度（与 Flutter hashCode 算法对齐） */
export function generateWaveform(messageId: string, barCount = 12): number[] {
  let seed = 0;
  for (let i = 0; i < messageId.length; i++) {
    seed = (Math.imul(31, seed) + messageId.charCodeAt(i)) | 0;
  }
  const heights: number[] = [];
  for (let i = 0; i < barCount; i++) {
    seed = (Math.imul(1664525, seed) + 1013904223) | 0;
    const rand = (seed >>> 0) / 0xffffffff;
    heights.push(0.3 + rand * 0.7);
  }
  return heights;
}
