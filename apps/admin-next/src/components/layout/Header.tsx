'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Menu,
  Search,
  Moon,
  Sun,
  Bell,
  User,
  Settings,
  LogOut,
  ChevronDown,
  X,
  Check,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useToastStore } from '@/store/useToastStore';
import { Dropdown, Breadcrumbs } from '@/components/UIComponents';
import { useRequest } from 'ahooks';
import { routes } from '@/routes';
import { getRoleI18nKey } from '@/constants';
import { useTranslation } from '@/hooks/useTranslation';
import { applicationApi } from '@/api';
import { useAvailableLocales } from '@/hooks/useAvailableLocales';
import type { Locale } from '@lucky/shared';

const PENDING_APPLICATIONS_UPDATED_EVENT = 'applications:pending-updated';

// ── Avatar helpers ────────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  'from-teal-400 to-teal-600',
  'from-blue-400 to-blue-600',
  'from-violet-400 to-violet-600',
  'from-amber-400 to-amber-600',
  'from-rose-400 to-rose-600',
  'from-emerald-400 to-emerald-600',
];

function avatarGradient(name: string) {
  const code = (name.charCodeAt(0) || 0) % AVATAR_COLORS.length;
  return AVATAR_COLORS[code];
}

// ── QuickNav search ───────────────────────────────────────────────────────────
function QuickNav() {
  const router = useRouter();
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return routes
      .filter((r) => !r.hidden)
      .filter((r) => {
        const label = (t(r.name) || r.name).toLowerCase();
        return label.includes(q) || r.path.includes(q);
      })
      .slice(0, 6);
  }, [query, t]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (path: string) => {
    router.push(path);
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative hidden md:block">
      <div className="flex items-center bg-gray-100 dark:bg-white/5 px-3 py-1.5 rounded-lg border border-transparent focus-within:border-primary-500/50 focus-within:bg-white dark:focus-within:bg-black/20 transition-all w-64 lg:w-80 group">
        <Search
          size={15}
          className="text-gray-400 mr-2 flex-shrink-0 group-focus-within:text-primary-500"
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={t('header_quickNavigate')}
          className="bg-transparent border-none outline-none text-sm w-full text-gray-700 dark:text-white placeholder-gray-400"
        />
        {query && (
          <button
            onClick={() => {
              setQuery('');
              setOpen(false);
            }}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 flex-shrink-0"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full left-0 mt-1.5 w-full bg-white dark:bg-dark-900 border border-gray-100 dark:border-white/10 rounded-xl shadow-lg shadow-black/10 overflow-hidden z-50">
          {results.map((r) => {
            const label = t(r.name) || r.name;
            const Icon = r.icon;
            return (
              <button
                key={r.path}
                onClick={() => handleSelect(r.path)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
              >
                <Icon size={14} className="text-gray-400 flex-shrink-0" />
                <span className="flex-1">{label}</span>
                <span className="text-xs text-gray-400 font-mono">
                  {r.path}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Small language selector wrapper using existing Dropdown component.
function LocaleDropdown({
  current,
  onSelect,
  locales,
  enabledLocales,
}: {
  current: Locale;
  onSelect: (code: Locale) => void;
  locales: { code: Locale; name: string }[];
  enabledLocales: { code: Locale; name: string }[];
}) {
  // Fallback mapping in case props return empty (shouldn't but safe)
  const fallbackNames: Record<string, string> = {
    zh: '中文',
    en: 'English',
    ja: '日本語',
    ko: '한국어',
    fr: 'Français',
    de: 'Deutsch',
  };

  const rawList = enabledLocales.length ? enabledLocales : locales;
  const list = (rawList ?? []).map((l) => {
    const code = l.code;
    const name = l.name ?? fallbackNames[code] ?? String(code);
    return { code, name };
  });

  let shortLabel = String(current).toUpperCase();
  if (current === 'en') {
    shortLabel = 'EN';
  } else if (current === 'zh') {
    shortLabel = '中';
  }

  const trigger = (
    <div className="p-2 text-gray-500 hover:text-primary-500 transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-white/5 flex items-center gap-2">
      <span className="font-bold text-xs">{shortLabel}</span>
      <ChevronDown size={12} className="text-gray-400" />
    </div>
  );

  const items = list.map((l) => ({
    label: l.name,
    icon: l.code === current ? <Check size={14} /> : undefined,
    onClick: () => onSelect(l.code),
  }));

  return <Dropdown trigger={trigger} items={items} />;
}

// ── Header ────────────────────────────────────────────────────────────────────
interface HeaderProps {
  onMenuButtonClickAction: () => void;
  breadcrumbs: string[];
}

export const Header: React.FC<HeaderProps> = ({
  onMenuButtonClickAction,
  breadcrumbs,
}) => {
  const router = useRouter();
  const { theme, toggleTheme } = useAppStore();
  const { t, lang, setLang: setI18nLang } = useTranslation();
  const logoutAction = useAuthStore((state) => state.logout);
  const userInfo = useAuthStore((state) => state.userInfo);
  const addToast = useToastStore((state) => state.addToast);
  const canReviewApplications = userInfo?.role === 'SUPER_ADMIN';
  const { locales, enabledLocales } = useAvailableLocales();

  const { loading: isLoggingOut, run: handleLogout } = useRequest(
    logoutAction,
    {
      manual: true,
      onSuccess: () => addToast('info', t('header_loggedOut')),
      onError: (error) =>
        addToast('error', t('header_logoutFailed', { message: error.message })),
    },
  );

  const { data: pendingData, refresh: refreshPendingCount } = useRequest(
    () => applicationApi.pendingCount(),
    {
      ready: canReviewApplications,
      pollingInterval: 60_000,
      pollingWhenHidden: false,
      onError: () => {
        // 403/401 等错误由 http 层处理，这里保持静默
      },
    },
  );

  useEffect(() => {
    if (!canReviewApplications) return;
    const handler = () => {
      void refreshPendingCount();
    };

    window.addEventListener(PENDING_APPLICATIONS_UPDATED_EVENT, handler);
    return () => {
      window.removeEventListener(PENDING_APPLICATIONS_UPDATED_EVENT, handler);
    };
  }, [canReviewApplications, refreshPendingCount]);

  const pendingCount = pendingData?.count ?? 0;

  const displayName =
    userInfo?.realName || userInfo?.username || t('user_fallbackName');
  const initial = Array.from(displayName)[0].toUpperCase();
  const gradient = avatarGradient(initial);

  return (
    <header className="h-16 bg-white/80 dark:bg-dark-900/80 backdrop-blur-md border-b border-gray-100 dark:border-white/5 flex items-center justify-between px-4 lg:px-8 z-30 sticky top-0 transition-colors duration-300">
      {/* Left */}
      <div className="flex items-center gap-4 flex-1 min-w-0">
        <button
          onClick={onMenuButtonClickAction}
          className="lg:hidden text-gray-500 flex-shrink-0"
        >
          <Menu size={24} />
        </button>
        <div className="hidden sm:block min-w-0">
          <Breadcrumbs items={breadcrumbs} />
        </div>
        <div className="ml-0 sm:ml-6 flex-1 max-w-sm">
          <QuickNav />
        </div>
      </div>

      {/* Right */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {canReviewApplications && (
          <button
            onClick={() => router.push('/admin-users')}
            title={`${t('pendingApplications')} (${pendingCount})`}
            aria-label={`${t('pendingApplications')}: ${pendingCount}`}
            className="relative p-2 text-gray-500 hover:text-primary-500 transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-white/5"
          >
            <Bell size={18} />
            {pendingCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none flex items-center justify-center">
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            )}
          </button>
        )}

        <div className="h-6 w-px bg-gray-200 dark:bg-white/10 mx-2" />

        {/* Language selector (dropdown) */}
        <LocaleDropdown
          current={lang as Locale}
          onSelect={(code) => {
            if (code !== lang) {
              setI18nLang(code);
            }
          }}
          locales={locales}
          enabledLocales={enabledLocales}
        />

        {/* Theme toggle — shows icon of what you'll switch TO */}
        <button
          onClick={toggleTheme}
          className="p-2 text-gray-500 hover:text-amber-500 transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-white/5"
          title={
            theme === 'dark'
              ? t('header_switchToLightMode')
              : t('header_switchToDarkMode')
          }
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* User menu */}
        <Dropdown
          trigger={
            <div className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity ml-1">
              {/* Initials avatar */}
              <div
                className={`w-8 h-8 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-semibold text-sm flex-shrink-0 ring-2 ring-transparent hover:ring-primary-500/40 transition-all`}
              >
                {initial}
              </div>
              <div className="hidden sm:flex flex-col leading-none">
                <span className="text-sm font-medium text-gray-800 dark:text-white">
                  {displayName}
                </span>
                {userInfo?.role && (
                  <span className="text-xs text-gray-400">
                    {t(getRoleI18nKey(userInfo.role)) || userInfo.role}
                  </span>
                )}
              </div>
              <ChevronDown
                size={13}
                className="text-gray-400 hidden sm:block"
              />
            </div>
          }
          items={[
            {
              label: t('header_adminUsers'),
              icon: <User size={16} />,
              onClick: () => router.push('/admin-users'),
            },
            {
              label: t('header_settings'),
              icon: <Settings size={16} />,
              onClick: () => router.push('/settings'),
            },
            {
              label: isLoggingOut ? t('header_loggingOut') : t('header_logout'),
              icon: <LogOut size={16} />,
              onClick: handleLogout,
              danger: true,
              disabled: isLoggingOut,
            },
          ]}
        />
      </div>
    </header>
  );
};
