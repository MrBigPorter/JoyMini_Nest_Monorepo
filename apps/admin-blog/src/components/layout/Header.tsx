'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Menu,
  Moon,
  Sun,
  LogOut,
  ChevronDown,
  Languages,
  Settings,
  Check,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useToastStore } from '@/store/useToastStore';
import { Dropdown } from '@/components/UIComponents';
import { useRequest } from 'ahooks';
import { ROLE_DISPLAY_NAMES } from '@/constants';
import { useTranslation } from '@/hooks/useTranslation';
import { useAvailableLocales } from '@/hooks/useAvailableLocales';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import type { Locale } from '@lucky/shared';

interface HeaderProps {
  onMenuButtonClick: () => void;
}

/** Language selector dropdown shown in the header */
function LocaleDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { enabledLocales } = useAvailableLocales();
  const { lang, setLang } = useTranslation();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="p-2 text-gray-500 hover:text-primary-500 transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-white/5"
        title="Switch language"
      >
        <Languages size={18} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-44 bg-white dark:bg-dark-800 rounded-xl shadow-xl border border-gray-100 dark:border-white/5 py-1 z-50"
          >
            {enabledLocales.map((locale) => (
              <button
                key={locale.code}
                onClick={() => {
                  setLang(locale.code as Locale);
                  setOpen(false);
                }}
                className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 transition-colors ${
                  lang === locale.code
                    ? 'text-primary-600 dark:text-primary-400 font-medium'
                    : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5'
                }`}
              >
                <span className="flex-1">{locale.nativeName}</span>
                {lang === locale.code && (
                  <Check size={14} className="text-primary-500" />
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const Header: React.FC<HeaderProps> = ({ onMenuButtonClick }) => {
  const router = useRouter();
  const { theme, toggleTheme } = useAppStore();
  const { t } = useTranslation();
  const logoutAction = useAuthStore((state) => state.logout);
  const userInfo = useAuthStore((state) => state.userInfo);
  const addToast = useToastStore((state) => state.addToast);

  const { loading: isLoggingOut, run: handleLogout } = useRequest(
    logoutAction,
    {
      manual: true,
      onSuccess: () => addToast('info', 'Logged out successfully'),
      onError: (error) => addToast('error', `Logout failed: ${error.message}`),
    },
  );

  const displayName = userInfo?.realName || userInfo?.username || 'Admin';
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <header className="h-16 bg-white/80 dark:bg-dark-900/80 backdrop-blur-md border-b border-gray-100 dark:border-white/5 flex items-center justify-between px-4 lg:px-8 z-30 sticky top-0 transition-colors duration-300">
      {/* Left */}
      <div className="flex items-center gap-4 flex-1 min-w-0">
        <button
          onClick={onMenuButtonClick}
          className="lg:hidden text-gray-500 flex-shrink-0"
        >
          <Menu size={24} />
        </button>
      </div>

      {/* Right */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Language selector */}
        <LocaleDropdown />

        {/* Theme toggle */}
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
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold text-sm flex-shrink-0 ring-2 ring-transparent hover:ring-primary-500/40 transition-all">
                {initial}
              </div>
              <div className="hidden sm:flex flex-col leading-none">
                <span className="text-sm font-medium text-gray-800 dark:text-white">
                  {displayName}
                </span>
                {userInfo?.role && (
                  <span className="text-xs text-gray-400">
                    {ROLE_DISPLAY_NAMES[userInfo.role] ?? userInfo.role}
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
