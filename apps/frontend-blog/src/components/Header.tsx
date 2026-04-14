'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter, usePathname } from '@/navigation';
import { useTheme } from 'next-themes';
import { Search, Sun, Moon, User, ChevronDown, Globe } from 'lucide-react';

export default function Header() {
  // Next.js 15 严格要求: 所有React Hooks必须在函数最顶端调用，中间不能有任何其他代码
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale() as 'zh' | 'en';
  const t = useTranslations();
  const { theme, setTheme, systemTheme } = useTheme();

  const currentLocale = locale;
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [langMenuOpen, setLangMenuOpen] = useState(false);

  // 极简语言切换 - 官方标准用法
  const switchLocale = (nextLocale: 'zh' | 'en') => {
    router.replace(pathname, { locale: nextLocale });
    setLangMenuOpen(false);
  };

  const toggleTheme = () => {
    const current = theme === 'system' ? systemTheme : theme;
    setTheme(current === 'dark' ? 'light' : 'dark');
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchQuery)}`);
    }
  };

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border"
      style={{ height: 'var(--header-height)' }}
    >
      {/* 安全区域占位 */}
      <div style={{ height: 'var(--safe-area-top)' }} />

      {/* 实际导航栏内容 */}
      <div className="h-14 px-4 md:px-6 max-w-7xl mx-auto flex items-center justify-between w-full">
        {/* Logo */}
        <Link href="/" className="font-bold text-lg flex items-center gap-2">
          <span className="text-primary text-xl">🐵</span>
          Tarsier Blog
        </Link>

        {/* 右侧操作区 */}
        <div className="flex items-center gap-2">
          {/* 搜索框 (Desktop) */}
          <form
            onSubmit={handleSearchSubmit}
            className="hidden md:flex relative"
          >
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder={t('search.placeholder')}
              className={`pl-10 pr-4 py-2 rounded-full border border-border bg-card text-sm w-48 transition-all ${
                searchFocused
                  ? 'w-64 border-primary/50 ring-2 ring-primary/20'
                  : 'hover:border-border/80'
              }`}
            />
          </form>

          {/* 主题切换 */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-full hover:bg-accent transition-all active:scale-95"
            title="切换主题"
          >
            <Sun className="w-5 h-5 dark:hidden" />
            <Moon className="w-5 h-5 hidden dark:block" />
          </button>

          {/* 搜索按钮 (Mobile) */}
          <Link
            href="/search"
            className="md:hidden p-2 rounded-full hover:bg-accent transition-all"
          >
            <Search className="w-5 h-5" />
          </Link>

          {/* 语言切换 */}
          <div className="relative">
            <button
              onClick={() => setLangMenuOpen(!langMenuOpen)}
              className="p-2 rounded-full hover:bg-accent transition-all active:scale-95 flex items-center gap-1"
              title="change language"
            >
              <Globe className="w-5 h-5" />
               <span className="text-xs font-medium">
                 {currentLocale === 'zh' ? '中文' : 'EN'}
               </span>
             </button>

             {langMenuOpen && (
               <div className="absolute right-0 top-full mt-2 bg-card border border-border rounded-lg shadow-lg min-w-32 overflow-hidden z-50">
                 <button
                   onClick={() => switchLocale('zh')}
                   className={`w-full px-4 py-2 text-left text-sm hover:bg-accent transition-colors ${
                     currentLocale === 'zh' ? 'bg-accent text-primary' : ''
                   }`}
                 >
                   🇨🇳 简体中文
                 </button>
                <button
                  onClick={() => switchLocale('en')}
                  className={`w-full px-4 py-2 text-left text-sm hover:bg-accent transition-colors ${
                    currentLocale === 'en' ? 'bg-accent text-primary' : ''
                  }`}
                >
                  🇺🇸 English
                </button>
              </div>
            )}
          </div>

          {/* 登录/用户按钮 */}
          <Link
            href="/login"
            className="px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-all active:scale-95"
          >
            {t('auth.login.button')}
          </Link>
        </div>
      </div>
    </header>
  );
}
