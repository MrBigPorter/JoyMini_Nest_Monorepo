'use client';

import React, { useState, useEffect } from 'react';
import { Image, ImageProps } from '@unpic/react';
import { ImageOff, Loader2 } from 'lucide-react';
import { cn } from '@repo/ui';

interface SmartImageProps extends Omit<ImageProps, 'cdn'> {
  /** 是否强制开启/关闭 CDN 优化 (默认读取环境变量 NEXT_PUBLIC_ENABLE_IMAGE_OPTIMIZATION) */
  enableOptimization?: boolean;
  /** 加载失败时的备用图片地址 (如果不传则显示图标) */
  fallbackSrc?: string;
  /** 容器的类名 (用于控制大小) */
  className?: string;
  /** 图片本身的类名 */
  imgClassName?: string;
}

export const SmartImageImpl: React.FC<SmartImageProps> = ({
  src,
  enableOptimization,
  fallbackSrc,
  className,
  imgClassName,
  alt = '',
  layout,
  loading = 'lazy',
  ...props
}) => {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>(
    'loading',
  );

  const imgRef = React.useRef<HTMLImageElement | null>(null);

  // 1. 判断是否为本地图片 (Blob URL 或 Base64)
  const isLocalImage = src?.startsWith('blob:') || src?.startsWith('data:');

  // 2. 计算是否使用 CDN
  // 规则：如果不强制指定，且不是本地图片，且环境变量开启，则使用 Cloudflare
  const shouldEnableCdn =
    !isLocalImage &&
    (enableOptimization ??
      process.env.NEXT_PUBLIC_ENABLE_IMAGE_OPTIMIZATION === 'true');

  // 监听 src 变化，重置状态 (防止表格复用组件时状态不更新)
  useEffect(() => {
    setStatus('loading');

    if (imgRef.current && imgRef.current.complete) {
      if (imgRef.current.naturalWidth === 0) {
        setStatus('error');
      } else {
        setStatus('loaded');
      }
    }
  }, [src]);

  const imageClassName = cn(
    'transition-opacity duration-500 ease-in-out',
    status === 'loaded' ? 'opacity-100' : 'opacity-0',
    imgClassName || 'w-full h-full object-cover',
  );

  const cdn = shouldEnableCdn ? ('cloudflare' as const) : undefined;

  const commonImageProps = {
    ref: imgRef,
    src,
    cdn,
    loading,
    onLoad: () => setStatus('loaded'),
    onError: () => setStatus('error'),
    className: imageClassName,
  };

  const mergeImageProps = (overrides: Partial<ImageProps>): ImageProps => {
    return {
      ...(props as ImageProps),
      ...(commonImageProps as unknown as ImageProps),
      ...overrides,
    } as ImageProps;
  };

  const renderImage = () => {
    if (!src) return null;

    if (layout === 'fixed') {
      const fixedProps = mergeImageProps({ layout: 'fixed', alt });
      return <Image {...fixedProps} alt={alt} />;
    }

    if (layout === 'fullWidth') {
      const fullWidthProps = mergeImageProps({ layout: 'fullWidth', alt });
      return <Image {...fullWidthProps} alt={alt} />;
    }

    if (layout === 'constrained') {
      const constrainedProps = mergeImageProps({ layout: 'constrained', alt });
      return <Image {...constrainedProps} alt={alt} />;
    }

    const defaultProps = mergeImageProps({ alt });

    return <Image {...defaultProps} alt={alt} />;
  };

  return (
    <div
      className={cn(
        'relative overflow-hidden bg-gray-100 dark:bg-gray-800 flex items-center justify-center',
        className,
      )}
    >
      {/* --- 1. Loading 状态 (骨架屏/转圈) --- */}
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
        </div>
      )}

      {/* --- 2. Error 状态 (加载失败) --- */}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 bg-gray-100 dark:bg-gray-800 z-20">
          {fallbackSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={fallbackSrc}
              alt={alt}
              className="w-full h-full object-cover"
            />
          ) : (
            <ImageOff size={20} />
          )}
        </div>
      )}

      {/* --- 3. 正常图片 (@unpic) --- */}
      {renderImage()}
    </div>
  );
};

export const SmartImage = React.memo(SmartImageImpl, (prev, next) => {
  const isSrcEqual = prev.src === next.src;
  const isClassNameEqual = prev.className === next.className;
  const isOptimizationEqual =
    prev.enableOptimization === next.enableOptimization;
  return isSrcEqual && isClassNameEqual && isOptimizationEqual;
});
