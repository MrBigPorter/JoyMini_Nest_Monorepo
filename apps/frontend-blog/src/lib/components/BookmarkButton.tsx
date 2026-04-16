'use client';

import { useState, useEffect } from 'react';
import { useRouter } from '@/navigation';
import { Button } from '@repo/ui';
import { Heart } from 'lucide-react';
import { useBookmarkStatus, useBookmarks } from '@/lib/hooks/useBookmarks';
import { useAuth } from '@/lib/hooks/useAuth';
import { useToast } from '@/lib/hooks/useToast';

export interface BookmarkButtonProps {
  /** 文章ID */
  articleId: string;
  /** 初始收藏状态 */
  initialBookmarked?: boolean;
  /** 按钮尺寸 */
  size?: 'sm' | 'md' | 'lg';
  /** 是否显示文字标签 */
  showLabel?: boolean;
  /** 是否显示加载状态 */
  showLoading?: boolean;
  /** 收藏状态变化回调 */
  onBookmarkChange?: (bookmarked: boolean) => void;
  /** 自定义类名 */
  className?: string;
  /** 是否始终显示（用于移动端/App端） */
  alwaysVisible?: boolean;
  /** 预加载的收藏状态，避免单独查询 */
  bookmarkStatus?: {
    isBookmarked?: boolean;
    bookmarkedAt?: string;
  };
}

/**
 * 收藏按钮组件
 * 提供可切换的收藏功能，支持不同尺寸和状态显示
 * 优化：支持移动端/App端始终显示，点击时才检查登录状态
 */
export function BookmarkButton({
  articleId,
  initialBookmarked = false,
  size = 'md',
  showLabel = false,
  showLoading = true,
  onBookmarkChange,
  className = '',
  alwaysVisible = true,
  bookmarkStatus,
}: BookmarkButtonProps) {
  const [optimisticBookmarked, setOptimisticBookmarked] = useState<
    boolean | null
  >(null);
  const [shouldCheckStatus, setShouldCheckStatus] = useState(false);
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const { show, success, error, info } = useToast();

  // 获取收藏状态 - 默认不启用查询，只在需要时启用
  const { data: status, isLoading: isStatusLoading } = useBookmarkStatus(
    articleId,
    shouldCheckStatus,
  );

  // 获取收藏操作函数
  const { addBookmark, removeBookmark, toggleBookmark, isBookmarkLoading } =
    useBookmarks();

  // 当用户登录状态变化时，如果已经点击过按钮，则重新检查收藏状态
  useEffect(() => {
    if (isAuthenticated && shouldCheckStatus) {
      // 重新获取收藏状态
      // 这里依赖useBookmarkStatus的enabled参数会自动处理
    }
  }, [isAuthenticated, shouldCheckStatus]);

  // 确定当前收藏状态（优先使用乐观更新，然后使用API状态，然后使用预加载状态，最后使用初始状态）
  const isBookmarked =
    optimisticBookmarked !== null
      ? optimisticBookmarked
      : (status?.isBookmarked ??
        bookmarkStatus?.isBookmarked ??
        initialBookmarked);

  // 确定是否正在加载
  const isLoading = isStatusLoading || (showLoading && isBookmarkLoading);

  // 处理未登录用户的登录流程
  const handleLoginRedirect = () => {
    // 显示提示信息
    info('请先登录以收藏文章');

    // 跳转到登录页面，并携带当前页面URL作为返回地址
    const currentPath = window.location.pathname;
    const searchParams = new URLSearchParams(window.location.search);
    const returnUrl = `${currentPath}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;

    router.push(`/login?returnUrl=${encodeURIComponent(returnUrl)}`);
  };

  // 处理点击事件
  const handleClick = async () => {
    if (!articleId) {
      error('文章ID不能为空');
      return;
    }

    // 如果是未登录用户，跳转到登录页面
    if (!isAuthenticated) {
      handleLoginRedirect();
      return;
    }

    // 如果是第一次点击，启用收藏状态查询
    if (!shouldCheckStatus) {
      setShouldCheckStatus(true);
      // 等待状态查询完成
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // 设置乐观更新
    const newBookmarked = !isBookmarked;
    setOptimisticBookmarked(newBookmarked);

    try {
      // 执行收藏/取消收藏操作
      if (newBookmarked) {
        await addBookmark(articleId);
        success('文章已添加到收藏夹');
      } else {
        await removeBookmark(articleId);
        success('文章已从收藏夹移除');
      }

      // 调用回调函数
      onBookmarkChange?.(newBookmarked);
    } catch (err) {
      // 操作失败，回滚乐观更新
      setOptimisticBookmarked(null);

      const errorMessage = newBookmarked ? '收藏失败' : '取消收藏失败';
      const errorDescription =
        err instanceof Error ? err.message : '请稍后重试';

      error(`${errorMessage}: ${errorDescription}`);
      console.error(`${errorMessage}:`, err);
    }
  };

  // 根据尺寸确定图标大小和文字
  const getSizeConfig = () => {
    switch (size) {
      case 'sm':
        return {
          iconSize: 16,
          textSize: 'text-sm',
          padding: 'px-2 py-1',
          touchSize: 'min-h-8 min-w-8', // 移动端最小触摸区域
        };
      case 'lg':
        return {
          iconSize: 20,
          textSize: 'text-lg',
          padding: 'px-4 py-2',
          touchSize: 'min-h-12 min-w-12',
        };
      case 'md':
      default:
        return {
          iconSize: 18,
          textSize: 'text-base',
          padding: 'px-3 py-1.5',
          touchSize: 'min-h-10 min-w-10',
        };
    }
  };

  const { iconSize, textSize, padding, touchSize } = getSizeConfig();

  // 确定按钮变体 - 修复类型错误
  const variant = isBookmarked ? 'primary' : 'outline';

  // 确定按钮文字
  const buttonText = isBookmarked ? '已收藏' : '收藏';

  // 移动端优化：增加触摸区域，优化点击反馈
  const mobileOptimizedClasses = `
    ${padding} ${textSize} ${className} ${touchSize}
    transition-all duration-200 active:scale-95
    ${
      isBookmarked
        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
        : 'border-input hover:bg-accent hover:text-accent-foreground'
    }
    ${alwaysVisible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
  `;

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleClick}
      disabled={isLoading}
      className={mobileOptimizedClasses.trim()}
      aria-label={isBookmarked ? '取消收藏' : '收藏'}
      aria-busy={isLoading}
    >
      {isLoading ? (
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          {showLabel && <span>处理中...</span>}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Heart
            className={`transition-all duration-200 ${
              isBookmarked
                ? 'fill-current text-current'
                : 'text-muted-foreground'
            }`}
            size={iconSize}
            strokeWidth={isBookmarked ? 2 : 1.5}
          />
          {showLabel && <span>{buttonText}</span>}
        </div>
      )}
    </Button>
  );
}

/**
 * 小型收藏按钮（仅图标）- 优化移动端体验
 */
export function BookmarkIconButton({
  articleId,
  initialBookmarked = false,
  size = 'md',
  onBookmarkChange,
  className = '',
  alwaysVisible = true,
  bookmarkStatus,
}: Omit<BookmarkButtonProps, 'showLabel'>) {
  return (
    <BookmarkButton
      articleId={articleId}
      initialBookmarked={initialBookmarked}
      size={size}
      showLabel={false}
      showLoading={false}
      onBookmarkChange={onBookmarkChange}
      alwaysVisible={alwaysVisible}
      className={`p-1.5 ${className}`}
      bookmarkStatus={bookmarkStatus}
    />
  );
}

/**
 * 带计数器的收藏按钮
 */
export function BookmarkButtonWithCount({
  articleId,
  initialBookmarked = false,
  count = 0,
  size = 'md',
  onBookmarkChange,
  className = '',
  alwaysVisible = true,
}: BookmarkButtonProps & { count?: number }) {
  const [shouldCheckStatus, setShouldCheckStatus] = useState(false);
  const { data: status } = useBookmarkStatus(articleId, shouldCheckStatus);
  const isBookmarked = status?.isBookmarked ?? initialBookmarked;

  const handleClick = () => {
    if (!shouldCheckStatus) {
      setShouldCheckStatus(true);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <BookmarkButton
        articleId={articleId}
        initialBookmarked={initialBookmarked}
        size={size}
        showLabel={false}
        onBookmarkChange={onBookmarkChange}
        alwaysVisible={alwaysVisible}
        className={className}
      />
      {count > 0 && (
        <span
          className={`text-sm text-muted-foreground ${
            isBookmarked ? 'text-primary' : ''
          }`}
        >
          {count}
        </span>
      )}
    </div>
  );
}

export default BookmarkButton;
