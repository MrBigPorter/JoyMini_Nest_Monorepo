'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter, usePathname } from '@/navigation';
import { useTheme } from '@/components/ThemeProvider';
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
import { ProtectedLink } from '@/components/auth/ProtectedLink';

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
  const { theme, setTheme } = useTheme();
  const { enabledLocales, isLoading: localesLoading } = useAvailableLocales();
  const { user, isAuthenticated, logout, isLoading: authLoading } = useAuth();
  const { isHydrated } = useAuthStore();

  const [showLanguageList, setShowLanguageList] = useState(false);

  const showAuthLoading = authLoading || !isHydrated;

  const switchLocale = (nextLocale: string) => {
    router.replace(pathname, { locale: nextLocale });
    setShowLanguageList(false);
    if (onClose) onClose();
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const handleLogout = () => {
    logout();
    if (onClose) onClose();
  };

  // 获取当前语言的显示名称
  const getLocaleDisplayName = (code: string) => {
    const locale = enabledLocales.find((l: LocaleConfig) => l.code === code);
    if (!locale) return code.toUpperCase();

    // 使用翻译键获取语言名称
    const translationKey = `settings.language.${code}`;
    try {
      const translatedName = t(translationKey);
      if (translatedName && translatedName !== translationKey) {
        return translatedName;
      }
    } catch (error) {
      // 如果翻译键不存在，回退到原始逻辑
    }

    // 回退逻辑：使用locale配置中的名称
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
    <div className="flex flex-col gap-2">
      {/* 用户信息 */}
      {showAuthLoading ? (
        <div className="p-4 rounded-xl bg-accent animate-pulse">
          <div className="h-6 bg-gray-300 dark:bg-gray-700 rounded w-32 mb-2" />
          <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-48" />
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
              <div className="font-medium text-lg">{user?.nickname}</div>
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
          className="p-4 rounded-xl bg-primary text-primary-foreground text-center font-medium hover:bg-primary/90 transition-colors"
        >
          {t('auth.login.button')}
        </Link>
      )}

      {/* 设置项列表 */}
      <div className="flex flex-col gap-1">
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
          disabled={localesLoading}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Globe className="w-5 h-5 text-primary" />
            </div>
            <div className="text-left">
              <div className="font-medium">{t('settings.language.name')}</div>
              <div className="text-sm text-muted-foreground">
                {localesLoading
                  ? t('settings.language.loading')
                  : getLocaleDisplayName(locale)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {localesLoading ? '...' : getLocaleDisplayName(locale)}
            </span>
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          </div>
        </button>

        {/* 语言列表 */}
        {showLanguageList && !localesLoading && enabledLocales.length > 0 && (
          <div className="ml-4 border-l border-border pl-2">
            {enabledLocales.map((localeItem: LocaleConfig) => (
              <button
                key={localeItem.code}
                onClick={() => switchLocale(localeItem.code)}
                className={`w-full flex items-center justify-between p-3 rounded-lg hover:bg-accent transition-colors ${
                  locale === localeItem.code ? 'bg-accent' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">
                    {getLocaleFlag(localeItem.code)}
                  </span>
                  <span>{t(`settings.language.${localeItem.code}`)}</span>
                </div>
                {locale === localeItem.code && (
                  <Check className="w-5 h-5 text-primary" />
                )}
              </button>
            ))}
          </div>
        )}

        {/* 我的收藏 - 使用ProtectedLink */}
        {isAuthenticated && (
          <ProtectedLink
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
          </ProtectedLink>
        )}

        {/* 登出按钮 */}
        {isAuthenticated && (
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-between p-4 rounded-xl hover:bg-accent transition-colors text-red-500"
            disabled={authLoading}
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
            <ChevronRight className="w-5 h-5 text-red-500/70" />
          </button>
        )}
      </div>
    </div>
  );
}
