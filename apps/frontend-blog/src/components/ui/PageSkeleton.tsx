'use client';

interface PageSkeletonProps {
  type?: 'article-list' | 'article-detail' | 'category-list' | 'search-results';
  count?: number;
  className?: string;
}

export function PageSkeleton({
  type = 'article-list',
  count = 6,
  className = '',
}: PageSkeletonProps) {
  const renderArticleListSkeleton = () => (
    <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8 py-12 md:py-16">
      {/* 标题骨架 */}
      <div className="mb-12 text-center md:text-left">
        <div className="h-12 w-64 bg-slate-200 dark:bg-slate-700 rounded-lg mb-4 animate-pulse mx-auto md:mx-0" />
      </div>

      {/* 文章卡片骨架 */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: count }).map((_, index) => (
          <div
            key={index}
            className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-6"
          >
            <div className="space-y-3">
              {/* 标题骨架 */}
              <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
              <div className="h-4 w-3/4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />

              {/* 摘要骨架 */}
              <div className="space-y-2">
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                <div className="h-4 w-5/6 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
              </div>

              {/* 底部元信息骨架 */}
              <div className="flex items-center justify-between pt-3">
                <div className="flex items-center gap-3">
                  <div className="h-4 w-20 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                  <div className="h-4 w-16 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                  <div className="h-4 w-12 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                </div>
                <div className="h-6 w-16 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderArticleDetailSkeleton = () => (
    <div className="max-w-4xl mx-auto px-4 py-8 md:py-12">
      {/* 标题骨架 */}
      <div className="mb-8">
        <div className="h-10 w-3/4 bg-slate-200 dark:bg-slate-700 rounded-lg mb-4 animate-pulse" />
        <div className="h-6 w-1/2 bg-slate-200 dark:bg-slate-700 rounded-lg animate-pulse" />
      </div>

      {/* 元信息骨架 */}
      <div className="flex items-center gap-4 mb-8">
        <div className="h-10 w-10 bg-slate-200 dark:bg-slate-700 rounded-full animate-pulse" />
        <div className="space-y-2">
          <div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
          <div className="h-3 w-24 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
        </div>
      </div>

      {/* 封面图骨架 */}
      <div className="h-64 w-full bg-slate-200 dark:bg-slate-700 rounded-xl mb-8 animate-pulse" />

      {/* 内容骨架 */}
      <div className="space-y-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="space-y-2">
            <div className="h-4 w-full bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
            <div className="h-4 w-5/6 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );

  const renderCategoryListSkeleton = () => (
    <div className="max-w-7xl mx-auto px-4 py-8 md:py-12">
      {/* 标题骨架 */}
      <div className="mb-10">
        <div className="h-10 w-48 bg-slate-200 dark:bg-slate-700 rounded-lg mb-4 animate-pulse" />
        <div className="h-6 w-96 bg-slate-200 dark:bg-slate-700 rounded-lg animate-pulse" />
      </div>

      {/* 分类卡片骨架 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: count }).map((_, index) => (
          <div
            key={index}
            className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-6"
          >
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 bg-slate-200 dark:bg-slate-700 rounded-lg animate-pulse" />
              <div className="flex-1 space-y-3">
                <div className="h-6 w-32 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                <div className="h-4 w-full bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                <div className="h-4 w-24 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderSearchResultsSkeleton = () => (
    <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
      {/* 搜索框骨架 */}
      <div className="relative mb-10">
        <div className="h-14 w-full bg-slate-200 dark:bg-slate-700 rounded-xl animate-pulse" />
      </div>

      {/* 结果统计骨架 */}
      <div className="h-12 w-48 bg-slate-200 dark:bg-slate-700 rounded-lg mb-6 animate-pulse" />

      {/* 结果列表骨架 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: count }).map((_, index) => (
          <div
            key={index}
            className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-6"
          >
            <div className="space-y-3">
              <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
              <div className="h-4 w-3/4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
              <div className="flex items-center justify-between pt-3">
                <div className="h-4 w-20 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                <div className="h-6 w-16 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  switch (type) {
    case 'article-detail':
      return renderArticleDetailSkeleton();
    case 'category-list':
      return renderCategoryListSkeleton();
    case 'search-results':
      return renderSearchResultsSkeleton();
    case 'article-list':
    default:
      return renderArticleListSkeleton();
  }
}
