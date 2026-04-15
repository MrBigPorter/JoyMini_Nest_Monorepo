'use client';

import { FileText, Search, FolderOpen, Tag, MessageSquare } from 'lucide-react';
import { Button } from '@repo/ui';

interface EmptyStateProps {
  type?:
    | 'articles'
    | 'search'
    | 'categories'
    | 'tags'
    | 'comments'
    | 'bookmarks';
  title?: string;
  description?: string;
  actionText?: string;
  onAction?: () => void;
  className?: string;
}

export function EmptyState({
  type = 'articles',
  title,
  description,
  actionText,
  onAction,
  className = '',
}: EmptyStateProps) {
  const getIcon = () => {
    switch (type) {
      case 'search':
        return (
          <Search className="w-16 h-16 text-slate-300 dark:text-slate-600" />
        );
      case 'categories':
        return (
          <FolderOpen className="w-16 h-16 text-slate-300 dark:text-slate-600" />
        );
      case 'tags':
        return <Tag className="w-16 h-16 text-slate-300 dark:text-slate-600" />;
      case 'comments':
        return (
          <MessageSquare className="w-16 h-16 text-slate-300 dark:text-slate-600" />
        );
      case 'articles':
      default:
        return (
          <FileText className="w-16 h-16 text-slate-300 dark:text-slate-600" />
        );
    }
  };

  const getDefaultTitle = () => {
    switch (type) {
      case 'search':
        return '没有找到相关文章';
      case 'categories':
        return '暂无分类';
      case 'tags':
        return '暂无标签';
      case 'comments':
        return '暂无评论';
      case 'articles':
      default:
        return '暂无文章';
    }
  };

  const getDefaultDescription = () => {
    switch (type) {
      case 'search':
        return '尝试使用不同的关键词搜索，或者浏览其他分类的文章。';
      case 'categories':
        return '文章分类将在管理员创建后显示在这里。';
      case 'tags':
        return '文章标签将在管理员创建后显示在这里。';
      case 'comments':
        return '成为第一个评论这篇文章的人吧！';
      case 'articles':
      default:
        return '这里还没有文章，管理员正在努力创作中。';
    }
  };

  const getDefaultActionText = () => {
    switch (type) {
      case 'search':
        return '浏览所有文章';
      case 'categories':
        return '浏览文章';
      case 'tags':
        return '浏览文章';
      case 'comments':
        return '发表评论';
      case 'articles':
      default:
        return '刷新页面';
    }
  };

  const icon = getIcon();
  const defaultTitle = title || getDefaultTitle();
  const defaultDescription = description || getDefaultDescription();
  const defaultActionText = actionText || getDefaultActionText();

  return (
    <div
      className={`flex flex-col items-center justify-center py-16 text-center ${className}`}
    >
      <div className="mb-6">{icon}</div>

      <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-2">
        {defaultTitle}
      </h3>

      <p className="text-slate-600 dark:text-slate-400 max-w-md mb-6">
        {defaultDescription}
      </p>

      {onAction && (
        <Button onClick={onAction} variant="outline">
          {defaultActionText}
        </Button>
      )}
    </div>
  );
}
