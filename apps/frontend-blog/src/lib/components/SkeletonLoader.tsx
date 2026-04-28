'use client';

import React from 'react';

/**
 * 基础骨架屏组件
 */
export function Skeleton({
  className = '',
  width,
  height,
  rounded = 'md',
  animated = true,
}: {
  className?: string;
  width?: string | number;
  height?: string | number;
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'full';
  animated?: boolean;
}) {
  const roundedClass = {
    none: 'rounded-none',
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    full: 'rounded-full',
  }[rounded];

  const animationClass = animated ? 'animate-pulse' : '';

  return (
    <div
      className={`bg-slate-200 dark:bg-slate-700 ${roundedClass} ${animationClass} ${className}`}
      style={{
        width: width
          ? typeof width === 'number'
            ? `${width}px`
            : width
          : '100%',
        height: height
          ? typeof height === 'number'
            ? `${height}px`
            : height
          : 'auto',
      }}
    />
  );
}

/**
 * 文本骨架屏
 */
export function TextSkeleton({
  lines = 1,
  lineHeight = 4,
  spacing = 2,
  width = '100%',
  lastLineWidth = '80%',
}: {
  lines?: number;
  lineHeight?: number;
  spacing?: number;
  width?: string;
  lastLineWidth?: string;
}) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          height={`${lineHeight * 0.25}rem`}
          width={index === lines - 1 ? lastLineWidth : width}
          rounded="md"
        />
      ))}
    </div>
  );
}

/**
 * 文章卡片骨架屏
 */
export function ArticleCardSkeleton() {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card transition-all duration-200 hover:border-primary/50 hover:bg-accent/50">
      {/* 图片骨架 */}
      <div className="aspect-[16/9] w-full overflow-hidden bg-slate-200 dark:bg-slate-700">
        <Skeleton height="100%" rounded="none" />
      </div>

      <div className="p-6">
        {/* 标题骨架 */}
        <div className="mb-3">
          <Skeleton height={6} width="80%" rounded="md" />
        </div>

        {/* 摘要骨架 */}
        <div className="mb-4 space-y-2">
          <Skeleton height={3} width="100%" rounded="md" />
          <Skeleton height={3} width="90%" rounded="md" />
          <Skeleton height={3} width="70%" rounded="md" />
        </div>

        {/* 元信息骨架 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* 作者头像骨架 */}
            <Skeleton width={8} height={8} rounded="full" />
            {/* 作者名骨架 */}
            <Skeleton width={16} height={3} rounded="md" />
          </div>

          <div className="flex items-center gap-4">
            {/* 日期骨架 */}
            <Skeleton width={12} height={3} rounded="md" />
            {/* 阅读时间骨架 */}
            <Skeleton width={10} height={3} rounded="md" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 文章列表骨架屏
 */
export function ArticleListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <ArticleCardSkeleton key={index} />
      ))}
    </div>
  );
}

/**
 * 分类卡片骨架屏
 */
export function CategoryCardSkeleton() {
  return (
    <div className="group block p-6 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-accent/50 transition-all duration-200">
      <div className="flex items-start gap-4">
        {/* 图标骨架 */}
        <Skeleton width={12} height={12} rounded="lg" />

        <div className="flex-1 min-w-0">
          {/* 分类名称骨架 */}
          <div className="mb-2">
            <Skeleton height={6} width="60%" rounded="md" />
          </div>

          {/* 描述骨架 */}
          <div className="mb-3 space-y-1">
            <Skeleton height={3} width="100%" rounded="md" />
            <Skeleton height={3} width="80%" rounded="md" />
          </div>

          {/* 文章数量骨架 */}
          <Skeleton width={20} height={3} rounded="md" />
        </div>
      </div>
    </div>
  );
}

/**
 * 分类列表骨架屏
 */
export function CategoryListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {Array.from({ length: count }).map((_, index) => (
        <CategoryCardSkeleton key={index} />
      ))}
    </div>
  );
}

/**
 * 文章详情页骨架屏
 */
export function ArticleDetailSkeleton() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
      {/* 返回按钮骨架 */}
      <div className="mb-8">
        <Skeleton width={24} height={4} rounded="md" />
      </div>

      {/* 文章头部骨架 */}
      <header className="mb-10">
        {/* 标题骨架 */}
        <div className="mb-6">
          <Skeleton height={10} width="90%" rounded="md" />
          <div className="mt-2">
            <Skeleton height={4} width="70%" rounded="md" />
          </div>
        </div>

        {/* 摘要骨架 */}
        <div className="mb-6 space-y-2">
          <Skeleton height={4} width="100%" rounded="md" />
          <Skeleton height={4} width="95%" rounded="md" />
          <Skeleton height={4} width="85%" rounded="md" />
        </div>

        {/* 元信息骨架 */}
        <div className="flex flex-wrap items-center gap-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex items-center gap-2">
              <Skeleton width={4} height={4} rounded="full" />
              <Skeleton width={12} height={3} rounded="md" />
            </div>
          ))}
        </div>
      </header>

      {/* 文章内容骨架 */}
      <article className="space-y-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton height={4} width="100%" rounded="md" />
            <Skeleton height={4} width="98%" rounded="md" />
            <Skeleton height={4} width="96%" rounded="md" />
          </div>
        ))}
      </article>

      {/* 评论区域骨架 */}
      <div className="mt-12">
        <div className="mb-6">
          <Skeleton height={6} width="20%" rounded="md" />
        </div>
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="p-4 border border-border rounded-lg">
              <div className="flex items-center gap-3 mb-3">
                <Skeleton width={8} height={8} rounded="full" />
                <div className="space-y-1">
                  <Skeleton width={16} height={3} rounded="md" />
                  <Skeleton width={12} height={2} rounded="md" />
                </div>
              </div>
              <div className="space-y-2">
                <Skeleton height={3} width="100%" rounded="md" />
                <Skeleton height={3} width="90%" rounded="md" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * 首页骨架屏
 */
export function HomePageSkeleton() {
  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8 py-8 md:py-12">
      {/* 标题区域骨架 */}
      <div className="mb-12 text-center md:text-left">
        <div className="mb-4">
          <Skeleton height={12} width="60%" rounded="md" />
        </div>
        <div className="max-w-2xl">
          <Skeleton height={6} width="80%" rounded="md" />
        </div>
      </div>

      {/* 文章列表骨架 */}
      <ArticleListSkeleton count={6} />

      {/* 加载更多骨架 */}
      <div className="mt-8 flex justify-center">
        <Skeleton width={32} height={10} rounded="lg" />
      </div>
    </div>
  );
}

/**
 * Hero Section Skeleton for loading state
 */
export function HeroSectionSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Main hero card skeleton */}
      <div className="lg:col-span-2">
        <div className="relative w-full aspect-[16/9] lg:aspect-[21/9] rounded-xl overflow-hidden">
          <Skeleton className="w-full h-full" />
        </div>
        <div className="mt-4 space-y-2">
          <Skeleton height={8} width="75%" rounded="md" />
          <Skeleton height={4} width="50%" rounded="md" />
        </div>
      </div>
      {/* Side cards skeleton */}
      <div className="hidden lg:flex flex-col gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex gap-4">
            <Skeleton width={24} height={16} rounded="lg" />
            <div className="flex-1 space-y-2">
              <Skeleton height={4} width="90%" rounded="md" />
              <Skeleton height={4} width="60%" rounded="md" />
            </div>
          </div>
        ))}
        <Skeleton width={24} height={4} rounded="md" className="mt-2" />
      </div>
    </div>
  );
}

/**
 * 分类页骨架屏
 */
export function CategoriesPageSkeleton() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
      {/* 页面标题骨架 */}
      <header className="mb-10">
        <div className="flex items-center gap-3 mb-4">
          <Skeleton width={8} height={8} rounded="md" />
          <Skeleton height={8} width="40%" rounded="md" />
        </div>
        <Skeleton height={4} width="60%" rounded="md" />
      </header>

      {/* 分类列表骨架 */}
      <CategoryListSkeleton count={6} />
    </div>
  );
}

/**
 * 页面加载器包装器
 */
export function PageSkeletonLoader({
  type = 'home',
  children,
}: {
  type?: 'home' | 'categories' | 'article' | 'custom';
  children?: React.ReactNode;
}) {
  if (children) {
    return <>{children}</>;
  }

  switch (type) {
    case 'home':
      return <HomePageSkeleton />;
    case 'categories':
      return <CategoriesPageSkeleton />;
    case 'article':
      return <ArticleDetailSkeleton />;
    default:
      return (
        <div className="flex flex-col items-center justify-center py-20">
          <Skeleton width={8} height={8} rounded="full" animated />
          <div className="mt-4">
            <Skeleton width={24} height={4} rounded="md" />
          </div>
        </div>
      );
  }
}

export default Skeleton;
