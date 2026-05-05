'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, LogOut, X } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { useToastStore } from '@/store/useToastStore';
import { getRoleI18nKey } from '@/constants';
import { routes, RouteConfig } from '@/routes';
import { useTranslation } from '@/hooks/useTranslation';
import { useRequest } from 'ahooks';

const sidebarRoutes = routes.filter((r) => !r.hidden);

const SidebarItem: React.FC<{
  to: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  isCollapsed: boolean;
  isActive: boolean;
  onClick?: () => void;
}> = ({ to, icon: Icon, label, isCollapsed, isActive, onClick }) => {
  return (
    <Link
      href={to}
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group ${
        isActive
          ? 'bg-primary-500/10 text-primary-500 font-medium'
          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white'
      }`}
    >
      <Icon size={20} className="flex-shrink-0" />
      {!isCollapsed && <span className="text-sm truncate">{label}</span>}
    </Link>
  );
};

interface SidebarProps {
  mobileOpen: boolean;
  onMobileCloseAction: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  mobileOpen,
  onMobileCloseAction,
}) => {
  const { t } = useTranslation();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const logoutAction = useAuthStore((state) => state.logout);
  const userInfo = useAuthStore((state) => state.userInfo);
  const addToast = useToastStore((state) => state.addToast);

  const { loading: isLoggingOut, run: handleLogout } = useRequest(
    logoutAction,
    {
      manual: true,
      onSuccess: () => addToast('info', t('header_loggedOut')),
      onError: (error) =>
        addToast('error', t('header_logoutFailed', { message: error.message })),
    },
  );

  const displayName =
    userInfo?.realName || userInfo?.username || t('user_fallbackName');
  const initial = displayName.charAt(0).toUpperCase();

  // Group routes by group
  const groupedRoutes = sidebarRoutes.reduce(
    (acc, route) => {
      const group = route.group;
      if (!acc[group]) acc[group] = [];
      acc[group].push(route);
      return acc;
    },
    {} as Record<string, RouteConfig[]>,
  );

  const sidebarContent = (
    <div className="h-full flex flex-col p-4">
      {/* Logo */}
      <div className="flex items-center gap-3 mb-8 px-2">
        <div className="w-8 h-8 rounded-lg flex-shrink-0 overflow-hidden">
          <Image
            src="/logo.png"
            alt="Logo"
            width={32}
            height={32}
            className="object-contain"
          />
        </div>
        {!collapsed && (
          <motion.h1
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-lg font-bold text-gray-900 dark:text-white tracking-tight"
          >
            {t('app_title')}
          </motion.h1>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto custom-scrollbar pr-2">
        {Object.entries(groupedRoutes).map(
          ([group, routesInGroup], groupIndex) => (
            <div key={group}>
              {/* Group label (expanded) or dot separator (collapsed) */}
              {collapsed ? (
                groupIndex > 0 && (
                  <div className="flex justify-center my-3">
                    <div className="w-1 h-1 rounded-full bg-gray-300 dark:bg-white/20" />
                  </div>
                )
              ) : (
                <div className="px-4 text-xs font-semibold text-gray-400 dark:text-gray-400 uppercase tracking-wider mb-2 mt-6 first:mt-0 whitespace-nowrap">
                  {t(group.toLowerCase()) || group}
                </div>
              )}
              {routesInGroup.map((route) => (
                <SidebarItem
                  key={route.path}
                  to={route.path}
                  icon={route.icon}
                  label={t(route.name) || route.name}
                  isCollapsed={collapsed}
                  isActive={
                    pathname === route.path ||
                    pathname.startsWith(route.path + '/')
                  }
                  onClick={onMobileCloseAction}
                />
              ))}
            </div>
          ),
        )}
      </nav>

      {/* User info */}
      {!collapsed && (
        <div className="pt-4 border-t border-gray-100 dark:border-white/10 mt-4">
          <div className="flex items-center gap-3 px-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">
              {initial}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                {displayName}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {userInfo?.role
                  ? t(getRoleI18nKey(userInfo.role)) || userInfo.role
                  : ''}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Logout */}
      <button
        onClick={handleLogout}
        disabled={isLoggingOut}
        className="flex items-center gap-3 px-3 py-2.5 mt-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all duration-200 w-full"
      >
        <LogOut size={20} className="flex-shrink-0" />
        {!collapsed && (
          <span className="text-sm">
            {isLoggingOut ? t('header_loggingOut') : t('header_logout')}
          </span>
        )}
      </button>

      {/* Collapse toggle (desktop only) */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="hidden lg:flex items-center justify-center mt-2 p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 transition-all duration-200"
      >
        {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
      </button>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:flex flex-col bg-white dark:bg-dark-900 border-r border-gray-100 dark:border-white/5 transition-all duration-300 ease-in-out ${
          collapsed ? 'w-20' : 'w-64'
        }`}
      >
        {sidebarContent}
      </aside>

      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 lg:hidden"
          >
            <div
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={onMobileCloseAction}
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="relative w-72 h-full bg-white dark:bg-dark-900"
            >
              <button
                onClick={onMobileCloseAction}
                className="absolute top-4 right-4 text-gray-400 hover:text-white"
              >
                <X size={20} />
              </button>
              {sidebarContent}
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
