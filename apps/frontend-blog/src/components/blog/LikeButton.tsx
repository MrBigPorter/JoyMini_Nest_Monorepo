'use client';

import { useState } from 'react';
import { Heart } from 'lucide-react';
import { Button } from '@repo/ui';
import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter } from '@/navigation';
import {
  useLikeStatus,
  useLikeArticle,
  useUnlikeArticle,
} from '@/lib/hooks/useArticleLike';
import type { LikeResponse } from '@/lib/types/frontend-blog';

interface LikeButtonProps {
  /** 文章 slug */
  slug: string;
  /** 初始点赞数（从 article.likes 传入） */
  initialCount?: number;
}

/**
 * 文章点赞按钮
 *
 * 交互逻辑：
 * - 未登录：点击跳转登录页
 * - 已登录 + 未点赞：点击点赞（POST /like）
 * - 已登录 + 已点赞：点击取消点赞（POST /unlike）
 * - 点赞数通过 mutation onSuccess 从服务端响应实时更新
 *
 * @example
 * <LikeButton slug={article.slug} initialCount={article.likes || 0} />
 */
export function LikeButton({ slug, initialCount = 0 }: LikeButtonProps) {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const [displayCount, setDisplayCount] = useState(initialCount);

  const { data: likeStatus, isLoading: isStatusLoading } = useLikeStatus(slug);
  const likeMutation = useLikeArticle(slug);
  const unlikeMutation = useUnlikeArticle(slug);

  const isLiked = likeStatus?.liked || false;
  const isPending = likeMutation.isPending || unlikeMutation.isPending;

  const handleToggle = () => {
    if (!isAuthenticated) {
      // 保存当前路径，登录后可以跳转回来
      const currentPath = window.location.pathname + window.location.search;
      sessionStorage.setItem('redirectAfterLogin', currentPath);
      router.push('/login');
      return;
    }

    if (isLiked) {
      unlikeMutation.mutate(undefined, {
        onSuccess: (data: LikeResponse) => {
          setDisplayCount(data.likeCount);
        },
      });
    } else {
      likeMutation.mutate(undefined, {
        onSuccess: (data: LikeResponse) => {
          setDisplayCount(data.likeCount);
        },
      });
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleToggle}
      disabled={isPending}
      className="gap-1"
      aria-label={isLiked ? '取消点赞' : '点赞'}
    >
      <Heart
        className={`h-4 w-4 ${isLiked ? 'fill-current text-red-500' : ''}`}
      />
      <span>{displayCount}</span>
    </Button>
  );
}
