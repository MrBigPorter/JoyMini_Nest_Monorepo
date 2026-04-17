'use client';

import { useState, useEffect } from 'react';
import { usePathname, Link } from '@/navigation';
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

export default function Sidebar() {
  const t = useTranslations();
  const pathname = usePathname();
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeStates, setActiveStates] = useState<Record<string, boolean>>({});
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);

    // 在客户端计算所有导航项的激活状态
    const newActiveStates: Record<string, boolean> = {};
    const navItems = [
      { href: '/', icon: Home, label: t('common.home') },
      { href: '/categories', icon: FolderOpen, label: t('common.categories') },
      { href: '/tags', icon: Tag, label: t('common.tags') },
      { href: '/bookmarks', icon: Bookmark, label: t('common.bookmarks') },
      { href: '/about', icon: User, label: t('common.about') },
    ];

    navItems.forEach((item) => {
      newActiveStates[item.href] = getIsActive(pathname, item.href);
    });

    setActiveStates(newActiveStates);
  }, [pathname, t]);

  const navItems = [
    { href: '/', icon: Home, label: t('common.home') },
    { href: '/categories', icon: FolderOpen, label: t('common.categories') },
    { href: '/tags', icon: Tag, label: t('common.tags') },
    { href: '/bookmarks', icon: Bookmark, label: t('common.bookmarks') },
    { href: '/about', icon: User, label: t('common.about') },
  ];

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
          // 双重渲染策略：服务器端渲染时不显示激活状态，客户端hydrate后显示
          // 服务器端：isActive = false，使用scale-100
          // 客户端：isActive = activeStates[item.href] || false，可能使用scale-110
          const isActive = isClient && (activeStates[item.href] || false);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-300 active:scale-95 relative ${
                isActive
                  ? 'bg-accent text-primary'
                  : 'text-foreground/70 hover:bg-accent/50 hover:text-foreground'
              }`}
            >
              {/* 左侧指示条 */}
              <div
                className={`absolute left-0 top-1/2 h-6 w-1 bg-primary rounded-r transition-all duration-300 transform -translate-y-1/2 ${
                  isActive ? 'opacity-100 scale-y-100' : 'opacity-0 scale-y-0'
                }`}
              />

              <Icon
                className={`w-5 h-5 flex-shrink-0 transition-all duration-300 ${
                  isActive
                    ? 'scale-110 text-primary animate-bounce-subtle'
                    : 'scale-100 text-foreground/70'
                }`}
              />
              <span
                className={`text-sm font-medium transition-all duration-300 ${
                  isExpanded ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'
                } ${isActive ? 'font-semibold' : 'font-medium'}`}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* 折叠指示器 */}
      <div className="p-3 border-t border-border">
        <button
          className="w-full flex items-center justify-center p-2 rounded-lg hover:bg-accent transition-colors"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? (
            <ChevronLeft className="w-5 h-5 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          )}
        </button>
      </div>
    </aside>
  );
}
