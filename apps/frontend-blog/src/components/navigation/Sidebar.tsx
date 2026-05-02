'use client';

import { useState } from 'react';
import { usePathname } from '@/navigation';
import { useTranslations } from 'next-intl';
import {
  Home,
  FolderOpen,
  Tag,
  Bookmark,
  User,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { getIsActive } from '@/lib/utils/navigation';
import { NavLink } from '@/components/AnimatedLink';
import { ProtectedLink } from '@/components/auth/ProtectedLink';

export default function Sidebar() {
  const t = useTranslations();
  const pathname = usePathname();
  const [isExpanded, setIsExpanded] = useState(false);

  const navItems = [
    { href: '/', icon: Home, label: t('common.home') },
    { href: '/categories', icon: FolderOpen, label: t('common.categories') },
    { href: '/tags', icon: Tag, label: t('common.tags') },
    {
      href: '/bookmarks',
      icon: Bookmark,
      label: t('common.bookmarks'),
      protected: true,
    },
    { href: '/about', icon: User, label: t('common.about') },
  ];

  // 定义样式常量，确保服务器端和客户端一致
  const linkBaseClass =
    'flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200';
  const activeClass = 'bg-primary/10 text-primary border border-primary/20';
  const inactiveClass =
    'hover:bg-accent text-foreground/80 hover:text-foreground';

  return (
    <aside
      className={`hidden md:flex fixed left-0 top-0 h-screen z-40 flex-col bg-background/80 backdrop-blur-xl border-r border-border transition-all duration-300 ease-in-out ${
        isExpanded ? 'w-60' : 'w-16'
      }`}
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
    >
      {/* Logo 区域 */}
      <div className="h-14 flex items-center justify-center border-b border-border">
        <span className="text-2xl">🐵</span>
      </div>

      {/* 导航菜单 */}
      <nav className="flex-1 pt-4 px-2 flex flex-col gap-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          // 统一 SSR 和 CSR 的激活状态计算
          // 服务器端也能计算，避免 hydration 不匹配
          const isActive = getIsActive(pathname, item.href);

          // 构建完整的className，确保服务器端和客户端一致
          const justifyClass = isExpanded ? 'justify-start' : 'justify-center';
          const linkClassName = `${linkBaseClass} ${
            isActive ? activeClass : inactiveClass
          } ${justifyClass}`;

          // 渲染受保护链接或普通链接 - 明确的左右布局
          const linkContent = (
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8">
                <Icon className="w-5 h-5" />
              </div>
              <span
                className={`whitespace-nowrap ${isExpanded ? '' : 'hidden'}`}
              >
                {item.label}
              </span>
            </div>
          );

          // 受保护路由使用ProtectedLink，普通路由使用NavLink
          if (item.protected) {
            return (
              <ProtectedLink
                key={item.href}
                href={item.href}
                className={linkClassName}
                title={item.label}
              >
                {linkContent}
              </ProtectedLink>
            );
          }

          return (
            <NavLink
              key={item.href}
              href={item.href}
              className={linkClassName}
              title={item.label}
              // P1-2 修复：非首页链接禁用自动 prefetch，避免触发 ISR 风暴
              prefetch={item.href === '/' ? undefined : false}
            >
              {linkContent}
            </NavLink>
          );
        })}
      </nav>

      {/* 折叠/展开按钮 */}
      <div className="p-2 border-t border-border">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full p-2 rounded-lg hover:bg-accent transition-colors flex items-center justify-center"
          title={isExpanded ? '收起' : '展开'}
        >
          {isExpanded ? (
            <ChevronLeft className="w-5 h-5" />
          ) : (
            <ChevronRight className="w-5 h-5" />
          )}
          <span className="sr-only">{isExpanded ? '收起' : '展开'}</span>
        </button>
      </div>
    </aside>
  );
}
