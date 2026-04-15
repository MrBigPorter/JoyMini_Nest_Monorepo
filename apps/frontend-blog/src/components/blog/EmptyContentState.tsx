'use client';

import {
  ArrowLeft,
  Home,
  Flame,
  FolderOpen,
  Tag as TagIcon,
} from 'lucide-react';
import { Link } from '@/navigation';

interface EmptyContentStateProps {
  type: 'category' | 'tag' | 'search' | 'bookmark';
  title: string;
  description: string;
  icon?: React.ReactNode;
  actions?: Array<{
    label: string;
    href: string;
    variant?: 'primary' | 'outline' | 'ghost';
    icon?: React.ReactNode;
  }>;
  className?: string;
}

// 按钮样式函数
const getButtonStyles = (
  variant: 'primary' | 'outline' | 'ghost' = 'primary',
) => {
  const baseStyles =
    'rounded-lg font-medium flex items-center justify-center gap-2 px-6 py-3 transition-all duration-200 min-w-[140px]';

  switch (variant) {
    case 'primary':
      return `${baseStyles} bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-lg shadow-primary-500/30 border border-transparent hover:from-primary-600 hover:to-primary-700`;
    case 'outline':
      return `${baseStyles} bg-transparent border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5`;
    case 'ghost':
      return `${baseStyles} text-gray-500 dark:text-gray-400 bg-transparent hover:bg-gray-100 dark:hover:bg-white/5`;
    default:
      return baseStyles;
  }
};

export function EmptyContentState({
  type,
  title,
  description,
  icon,
  actions = [],
  className = '',
}: EmptyContentStateProps) {
  // 默认图标
  const getDefaultIcon = () => {
    switch (type) {
      case 'category':
        return <FolderOpen className="w-16 h-16 text-primary/60" />;
      case 'tag':
        return <TagIcon className="w-16 h-16 text-primary/60" />;
      case 'search':
        return <div className="text-6xl">🔍</div>;
      case 'bookmark':
        return <div className="text-6xl">📑</div>;
      default:
        return <div className="text-6xl">📄</div>;
    }
  };

  // 默认操作
  const getDefaultActions = () => {
    const defaultActions: Array<{
      label: string;
      href: string;
      variant?: 'primary' | 'outline' | 'ghost';
      icon?: React.ReactNode;
    }> = [];

    switch (type) {
      case 'category':
        defaultActions.push(
          {
            label: '返回分类列表',
            href: '/categories',
            variant: 'primary',
            icon: <ArrowLeft className="w-4 h-4" />,
          },
          {
            label: '返回首页',
            href: '/',
            variant: 'outline',
            icon: <Home className="w-4 h-4" />,
          },
        );
        break;
      case 'tag':
        defaultActions.push(
          {
            label: '返回标签墙',
            href: '/tags',
            variant: 'primary',
            icon: <ArrowLeft className="w-4 h-4" />,
          },
          {
            label: '浏览热门文章',
            href: '/',
            variant: 'outline',
            icon: <Flame className="w-4 h-4" />,
          },
        );
        break;
      case 'search':
        defaultActions.push({
          label: '浏览所有文章',
          href: '/',
          variant: 'primary',
        });
        break;
      case 'bookmark':
        defaultActions.push({
          label: '返回首页',
          href: '/',
          variant: 'primary',
          icon: <Home className="w-4 h-4" />,
        });
        break;
    }

    return defaultActions;
  };

  const displayIcon = icon || getDefaultIcon();
  const displayActions = actions.length > 0 ? actions : getDefaultActions();

  return (
    <div
      className={`flex flex-col items-center justify-center py-20 px-4 text-center ${className}`}
    >
      <div className="mb-8" aria-hidden="true">
        {displayIcon}
      </div>

      <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
        {title}
      </h2>

      <p className="text-slate-600 dark:text-slate-400 mb-10 max-w-md text-lg">
        {description}
      </p>

      {displayActions.length > 0 && (
        <div className="flex flex-wrap gap-4 justify-center">
          {displayActions.map((action, index) => (
            <Link
              key={index}
              href={action.href}
              className={getButtonStyles(action.variant)}
            >
              {action.icon && <span className="mr-2">{action.icon}</span>}
              {action.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
