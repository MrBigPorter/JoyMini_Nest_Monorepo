'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter, usePathname } from '@/navigation';
import { useTheme } from 'next-themes';
import {
  Search,
  Sun,
  Moon,
  User,
  ChevronDown,
  Globe,
  Bookmark,
} from 'lucide-react';
import { useAvailableLocales } from '@/hooks/useAvailableLocales';
import { useAuth } from '@/lib/hooks/useAuth';
import { useAuthStore } from '@/lib/stores/auth.store';

interface LocaleConfig {
  code: string;
  name: string;
  nativeName: string;
  enabled: boolean;
  isDefault: boolean;
}

export default function Header() {
  // Next.js 15 严格要求: 所有React Hooks必须在函数最顶端调用，中间不能有任何其他代码
  const router = useRouter();
  const pathname = usePathname();

  const locale = useLocale() as string;
  const t = useTranslations();
  const { theme, setTheme, systemTheme } = useTheme();
  const { enabledLocales, isLoading: localesLoading } = useAvailableLocales();

  const currentLocale = locale;
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  // 认证状态
  const { user, isAuthenticated, logout, isLoading: authLoading } = useAuth();
  // 水合状态
  const { isHydrated } = useAuthStore();

  console.log('Header rendered:', {
    isAuthenticated,
    authLoading,
    isHydrated,
    user: user ? 'present' : 'null',
    timestamp: Date.now(),
  });

  // 在水合完成前显示加载状态
  const showAuthLoading = authLoading || !isHydrated;

  // 动态语言切换
  const switchLocale = (nextLocale: string) => {
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

  // 获取当前语言的显示名称
  const getLocaleDisplayName = (code: string) => {
    const locale = enabledLocales.find((l: LocaleConfig) => l.code === code);
    if (!locale) return code.toUpperCase();

    if (code === 'zh') return '中文';
    if (code === 'en') return 'EN';
    return locale.name.substring(0, 2).toUpperCase();
  };

  // 获取语言国旗emoji
  const getLocaleFlag = (code: string) => {
    const flags: Record<string, string> = {
      zh: '🇨🇳',
      en: '🇺🇸',
      ja: '🇯🇵',
      ko: '🇰🇷',
      fr: '🇫🇷',
      de: '🇩🇪',
    };
    return flags[code] || '🌐';
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
              disabled={localesLoading}
            >
              <Globe className="w-5 h-5" />
              <span className="text-xs font-medium">
                {localesLoading ? '...' : getLocaleDisplayName(currentLocale)}
              </span>
            </button>

            {langMenuOpen && !localesLoading && enabledLocales.length > 0 && (
              <div className="absolute right-0 top-full mt-2 bg-card border border-border rounded-lg shadow-lg min-w-32 overflow-hidden z-50">
                {enabledLocales.map((locale: LocaleConfig) => (
                  <button
                    key={locale.code}
                    onClick={() => switchLocale(locale.code)}
                    className={`w-full px-4 py-2 text-left text-sm hover:bg-accent transition-colors flex items-center gap-2 ${
                      currentLocale === locale.code
                        ? 'bg-accent text-primary'
                        : ''
                    }`}
                  >
                    <span className="text-base">
                      {getLocaleFlag(locale.code)}
                    </span>
                    <span>{locale.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 登录/用户按钮 */}
          {showAuthLoading ? (
            // 水合完成前显示加载状态
            <div className="w-20 h-8 bg-gray-200 dark:bg-gray-700 rounded-full animate-pulse" />
          ) : isAuthenticated ? (
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2 px-3 py-2 rounded-full hover:bg-accent transition-all"
                title={user?.nickname || '用户'}
              >
                {user?.avatar ? (
                  <img
                    src={user.avatar}
                    alt={user.nickname}
                    className="w-6 h-6 rounded-full"
                  />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                    <User className="w-4 h-4 text-primary" />
                  </div>
                )}
                <span className="text-sm font-medium hidden md:inline">
                  {user?.nickname || '用户'}
                </span>
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              </button>

              {/* 用户菜单 */}
              {userMenuOpen && (
                <div className="absolute right-0 top-full mt-2 bg-card border border-border rounded-lg shadow-lg min-w-40 overflow-hidden z-50">
                  <div className="px-4 py-3 border-b border-border">
                    <div className="font-medium text-sm">
                      {user?.nickname || '用户'}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {user?.email || '未设置邮箱'}
                    </div>
                  </div>

                  {/* 收藏入口 */}
                  <Link
                    href="/bookmarks"
                    onClick={() => setUserMenuOpen(false)}
                    className="w-full px-4 py-2 text-left text-sm hover:bg-accent transition-colors flex items-center gap-2"
                  >
                    <Bookmark className="w-4 h-4" />
                    <span>我的收藏</span>
                  </Link>

                  <div className="border-t border-border my-1" />

                  <button
                    onClick={() => {
                      logout();
                      setUserMenuOpen(false);
                    }}
                    className="w-full px-4 py-2 text-left text-sm hover:bg-accent transition-colors text-red-500"
                    disabled={authLoading}
                  >
                    {authLoading ? '退出中...' : '退出登录'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              href="/login"
              className="px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-all active:scale-95"
            >
              {t('auth.login.button')}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
