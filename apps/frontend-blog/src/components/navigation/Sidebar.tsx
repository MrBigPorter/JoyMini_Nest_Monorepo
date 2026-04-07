'use client';

import { useState } from 'react';
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

export default function Sidebar() {
  const t = useTranslations();
  const pathname = usePathname();
  const [isExpanded, setIsExpanded] = useState(false);

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
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${
                isActive
                  ? 'bg-accent text-primary'
                  : 'text-foreground/70 hover:bg-accent/50 hover:text-foreground'
              }`}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              <span
                className={`text-sm font-medium transition-opacity duration-300 ${
                  isExpanded ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'
                }`}
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
