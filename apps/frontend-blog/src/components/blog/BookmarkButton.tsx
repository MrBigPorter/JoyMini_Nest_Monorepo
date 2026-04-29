'use client';

import { useState, useEffect } from 'react';
import { Bookmark } from 'lucide-react';
import { Button } from '@repo/ui';
import { useAuth } from '@/lib/hooks/useAuth';
import { blogApi } from '@/lib/api/blogApi';
import useSWR from 'swr';
import { useRouter } from '@/navigation';
import { withLocale } from '@/lib/utils/locale';

interface BookmarkButtonProps {
  articleId: string;
  size?: 'sm' | 'md' | 'lg';
  variant?:
    | 'primary'
    | 'secondary'
    | 'danger'
    | 'ghost'
    | 'outline'
    | 'success'
    | 'warning'
    | 'info'
    | 'link';
  className?: string;
  showText?: boolean;
}

export function BookmarkButton({
  articleId,
  size = 'sm',
  variant = 'ghost',
  className = '',
  showText = false,
}: BookmarkButtonProps) {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const { data, mutate, isLoading } = useSWR(
    isAuthenticated ? `/bookmark-status/${articleId}` : null,
    () => blogApi.checkBookmarkStatus(articleId),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );

  const isBookmarked = data?.isBookmarked || false;

  const handleToggle = async () => {
    if (!isAuthenticated) {
      // 保存当前路径，登录后可以跳转回来
      const currentPath = window.location.pathname + window.location.search;
      sessionStorage.setItem('redirectAfterLogin', currentPath);
      // 直接使用登录路径，让国际化路由中间件处理语言前缀
      router.push('/login');
      return;
    }

    try {
      if (isBookmarked) {
        await blogApi.removeBookmark(articleId);
      } else {
        await blogApi.addBookmark(articleId);
      }

      // 乐观更新
      mutate({ isBookmarked: !isBookmarked }, false);
    } catch (error) {
      console.error('Failed to toggle bookmark:', error);
    }
  };

  const getButtonText = () => {
    if (isBookmarked) {
      return showText ? '已收藏' : '';
    } else {
      return showText ? '收藏' : '';
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleToggle}
      disabled={isClient ? isLoading : undefined}
      className={`gap-1 ${className}`}
      aria-label={isBookmarked ? '取消收藏' : '收藏'}
    >
      <Bookmark
        className={`w-4 h-4 ${isBookmarked ? 'fill-current text-primary' : ''}`}
      />
      {showText && <span>{getButtonText()}</span>}
    </Button>
  );
}

/**
 * 小型收藏按钮，适合在文章卡片中使用
 */
export function SmallBookmarkButton({ articleId }: { articleId: string }) {
  return (
    <BookmarkButton
      articleId={articleId}
      size="sm"
      variant="ghost"
      className="p-1 hover:bg-accent/50"
    />
  );
}

/**
 * 带文字的收藏按钮
 */
export function BookmarkButtonWithText({ articleId }: { articleId: string }) {
  return (
    <BookmarkButton
      articleId={articleId}
      size="md"
      variant="outline"
      showText={true}
      className="px-3"
    />
  );
}
