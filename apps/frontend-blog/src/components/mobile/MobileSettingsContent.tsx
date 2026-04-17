'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter, usePathname } from '@/navigation';
import { useTheme } from 'next-themes';
import { useAvailableLocales } from '@/hooks/useAvailableLocales';
import { useAuth } from '@/lib/hooks/useAuth';
import { useAuthStore } from '@/lib/stores/auth.store';
import {
  Sun,
  Moon,
  Globe,
  User,
  Bookmark,
  Settings,
  LogOut,
  ChevronRight,
  Check,
} from 'lucide-react';

interface LocaleConfig {
  code: string;
  name: string;
  nativeName: string;
  enabled: boolean;
  isDefault: boolean;
}

interface MobileSettingsContentProps {
  onClose?: () => void;
}

export function MobileSettingsContent({ onClose }: MobileSettingsContentProps) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme, systemTheme } = useTheme();
  const { enabledLocales, isLoading: localesLoading } = useAvailableLocales();
  const { user, isAuthenticated, logout, isLoading: authLoading } = useAuth();
  const { isHydrated } = useAuthStore();

  const [showLanguageList, setShowLanguageList] = useState(false);

  const showAuthLoading = authLoading || !isHydrated;

  const switchLocale = (nextLocale: string) => {
    router.replace(pathname, { locale: nextLocale });
    setShowLanguageList(false);
    onClose?.();
  };

  const toggleTheme = () => {
    const current = theme === 'system' ? systemTheme : theme;
    setTheme(current === 'dark' ? 'light' : 'dark');
  };

  const handleLogout = () => {
    logout();
    onClose?.();
  };

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

  const getCurrentLocaleDisplay = () => {
    if (localesLoading || enabledLocales.length === 0) {
      return `🌐 ${t('settings.language.select')}`;
    }

    const current = enabledLocales.find((l: LocaleConfig) => l.code === locale);
    if (current) {
      return `${getLocaleFlag(current.code)} ${current.name}`;
    }

    // 默认显示第一个语言
    const defaultLocale = enabledLocales[0] as LocaleConfig;
    return `${getLocaleFlag(defaultLocale.code)} ${defaultLocale.name}`;
  };

  return (
    <div className="space-y-6">
      {/* 用户信息区域 */}
      {showAuthLoading ? (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-accent animate-pulse">
          <div className="w-12 h-12 rounded-full bg-gray-300 dark:bg-gray-700" />
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-24" />
            <div className="h-3 bg-gray-300 dark:bg-gray-700 rounded w-32" />
          </div>
        </div>
      ) : isAuthenticated ? (
        <div className="p-4 rounded-xl bg-accent">
          <div className="flex items-center gap-3">
            {user?.avatar ? (
              <img
                src={user.avatar}
                alt={user.nickname}
                className="w-12 h-12 rounded-full"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                <User className="w-6 h-6 text-primary" />
              </div>
            )}
            <div className="flex-1">
              <div className="font-medium text-foreground">
                {user?.nickname || t('settings.user')}
              </div>
              <div className="text-sm text-muted-foreground truncate">
                {user?.email || t('settings.emailNotSet')}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <Link
          href="/login"
          onClick={onClose}
          className="flex items-center justify-between p-4 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary-foreground/20 flex items-center justify-center">
              <User className="w-5 h-5" />
            </div>
            <div>
              <div className="font-medium">{t('settings.loginRegister')}</div>
              <div className="text-sm opacity-90">
                {t('settings.joinCommunity')}
              </div>
            </div>
          </div>
          <ChevronRight className="w-5 h-5" />
        </Link>
      )}

      {/* 设置项列表 */}
      <div className="space-y-2">
        {/* 主题切换 */}
        <button
          onClick={toggleTheme}
          className="w-full flex items-center justify-between p-4 rounded-xl hover:bg-accent transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              {theme === 'dark' ? (
                <Moon className="w-5 h-5 text-primary" />
              ) : (
                <Sun className="w-5 h-5 text-primary" />
              )}
            </div>
            <div className="text-left">
              <div className="font-medium">{t('settings.theme.name')}</div>
              <div className="text-sm text-muted-foreground">
                {theme === 'dark'
                  ? t('settings.theme.dark')
                  : t('settings.theme.light')}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {theme === 'dark'
                ? t('settings.theme.dark')
                : t('settings.theme.light')}
            </span>
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          </div>
        </button>

        {/* 语言选择 */}
        <button
          onClick={() => setShowLanguageList(!showLanguageList)}
          className="w-full flex items-center justify-between p-4 rounded-xl hover:bg-accent transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Globe className="w-5 h-5 text-primary" />
            </div>

            <div className="text-left">
              <div className="font-medium">{t('settings.language.name')}</div>
              <div className="text-sm text-muted-foreground">
                {localesLoading
                  ? t('common.loading')
                  : getCurrentLocaleDisplay()}
              </div>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-muted-foreground" />
        </button>

        {/* 语言列表 */}
        {showLanguageList && !localesLoading && (
          <div className="ml-12 space-y-1">
            {enabledLocales.map((localeConfig: LocaleConfig) => (
              <button
                key={localeConfig.code}
                onClick={() => {
                  switchLocale(localeConfig.code);
                }}
                className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-accent transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg">
                    {getLocaleFlag(localeConfig.code)}
                  </span>
                  <span>{t(`settings.language.${localeConfig.code}`)}</span>
                </div>
                {locale === localeConfig.code && (
                  <Check className="w-5 h-5 text-primary" />
                )}
              </button>
            ))}
          </div>
        )}

        {/* 我的收藏 */}
        {isAuthenticated && (
          <Link
            href="/bookmarks"
            onClick={onClose}
            className="w-full flex items-center justify-between p-4 rounded-xl hover:bg-accent transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Bookmark className="w-5 h-5 text-primary" />
              </div>
              <div className="font-medium">{t('settings.bookmarks')}</div>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          </Link>
        )}

        {/* 退出登录 */}
        {isAuthenticated && (
          <button
            onClick={handleLogout}
            disabled={authLoading}
            className="w-full flex items-center justify-between p-4 rounded-xl hover:bg-accent transition-colors text-red-500"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                <LogOut className="w-5 h-5 text-red-500" />
              </div>
              <div className="font-medium">
                {authLoading
                  ? t('settings.logout.loading')
                  : t('settings.logout.name')}
              </div>
            </div>
          </button>
        )}
      </div>

      {/* 版本信息 */}
      <div className="pt-4 border-t border-border">
        <div className="text-center text-sm text-muted-foreground">
          {t('settings.version')}
        </div>
      </div>
    </div>
  );
}
