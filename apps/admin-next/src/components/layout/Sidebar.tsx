'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { LogOut, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useToastStore } from '@/store/useToastStore';
import { getRoleI18nKey } from '@/constants';
import { routes, RouteConfig } from '@/routes';
import { useRequest } from 'ahooks';
import { motion, AnimatePresence } from 'framer-motion';
import { applicationApi } from '@/api';
import { useTranslation } from '@/hooks/useTranslation';

const PENDING_APPLICATIONS_UPDATED_EVENT = 'applications:pending-updated';

// ── SidebarItem ───────────────────────────────────────────────────────────────
const SidebarItem: React.FC<{
  to: string;
  icon: React.ReactNode;
  label: string;
  isCollapsed: boolean;
  badge?: number;
  onClick?: () => void;
}> = ({ to, icon, label, isCollapsed, badge, onClick }) => {
  const pathname = usePathname();
  const isActive =
    to === '/' ? pathname === '/' || pathname === '' : pathname.startsWith(to);

  return (
    <Link
      href={to}
      onClick={onClick}
      title={isCollapsed ? label : undefined}
      className={`
        relative flex items-center gap-3 rounded-xl transition-all duration-200 font-medium
        ${
          isActive
            ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/30'
            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white'
        }
        ${isCollapsed ? 'justify-center py-3 px-0 h-12' : 'justify-start px-4 py-3'}
      `}
    >
      {icon}
      <motion.span
        initial={false}
        animate={{
          opacity: isCollapsed ? 0 : 1,
          width: isCollapsed ? 0 : 'auto',
          display: isCollapsed ? 'none' : 'block',
        }}
        transition={{ duration: 0.2 }}
        className="overflow-hidden whitespace-nowrap flex-1"
      >
        {label}
      </motion.span>
      {/* Badge — pending count */}
      {badge != null && badge > 0 && (
        <span
          className={`min-w-[18px] h-[18px] text-[10px] font-bold bg-red-500 text-white rounded-full flex items-center justify-center px-1 flex-shrink-0 ${isCollapsed ? 'absolute top-1 right-1' : ''}`}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  );
};

// ── Sidebar ───────────────────────────────────────────────────────────────────
interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  mobileOpen,
  onMobileClose,
}) => {
  const { isSidebarCollapsed, toggleSidebar } = useAppStore();
  const logoutAction = useAuthStore((state) => state.logout);
  const userInfo = useAuthStore((state) => state.userInfo);
  const addToast = useToastStore((state) => state.addToast);
  // Prefer using the useTranslation hook so we keep translations in sync with LanguageProvider
  const { t } = useTranslation();
  const canReviewApplications = userInfo?.role === 'SUPER_ADMIN';

  const { loading: isLoggingOut, run: handleLogout } = useRequest(
    logoutAction,
    {
      manual: true,
      onSuccess: () => addToast('info', t('header_loggedOut')),
      onError: (error) =>
        addToast('error', t('header_logoutFailed', { message: error.message })),
    },
  );

  // Pending application count for badge on /users menu item
  const { data: pendingData, refresh: refreshPendingCount } = useRequest(
    () => applicationApi.pendingCount(),
    {
      ready: canReviewApplications,
      pollingInterval: 60_000, // refresh every 60s
      pollingWhenHidden: false, // 切后台时暂停，减少无效请求
      onError: () => {
        // 静默处理（401 已由 http 层统一跳转登录，这里不再弹 toast）
      },
    },
  );

  React.useEffect(() => {
    if (!canReviewApplications) return;
    const handler = () => {
      void refreshPendingCount();
    };

    window.addEventListener(PENDING_APPLICATIONS_UPDATED_EVENT, handler);
    return () => {
      window.removeEventListener(PENDING_APPLICATIONS_UPDATED_EVENT, handler);
    };
  }, [canReviewApplications, refreshPendingCount]);

  const groupedRoutes = routes
    .filter((route) => !route.hidden)
    .reduce(
      (acc, route) => {
        const group = route.group;
        if (!acc[group]) acc[group] = [];
        acc[group].push(route);
        return acc;
      },
      {} as Record<string, RouteConfig[]>,
    );

  const displayName =
    userInfo?.realName || userInfo?.username || t('user_fallbackName');

  return (
    <>
      <aside
        className={`
          fixed inset-y-0 left-0 z-40 bg-white dark:bg-dark-900 border-r border-gray-100 dark:border-white/5
          transform transition-all duration-300 ease-in-out
          lg:relative lg:translate-x-0
          ${isSidebarCollapsed ? 'w-20' : 'w-64'}
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="h-full flex flex-col p-4">
          {/* Logo */}
          <div
            className={`flex items-center gap-3 px-4 py-6 mb-4 transition-all ${isSidebarCollapsed ? 'justify-center' : ''}`}
          >
            <div className="w-8 h-8 rounded-lg flex-shrink-0 overflow-hidden">
              <Image
                src="/logo.png"
                alt="JoyMini Admin"
                width={32}
                height={32}
                className="w-full h-full object-contain"
              />
            </div>
            <motion.h1
              animate={{
                opacity: isSidebarCollapsed ? 0 : 1,
                width: isSidebarCollapsed ? 0 : 'auto',
                display: isSidebarCollapsed ? 'none' : 'block',
              }}
              className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-400 overflow-hidden whitespace-nowrap"
            >
              JoyMini Admin
            </motion.h1>
          </div>

          {/* Nav */}
          <nav className="flex-1 space-y-1 overflow-y-auto custom-scrollbar pr-2">
            {Object.entries(groupedRoutes).map(
              ([group, routesInGroup], groupIndex) => (
                <div key={group}>
                  {/* Group label (expanded) or dot separator (collapsed) */}
                  {isSidebarCollapsed ? (
                    groupIndex > 0 && (
                      <div className="flex justify-center my-3">
                        <div className="w-1 h-1 rounded-full bg-gray-300 dark:bg-white/20" />
                      </div>
                    )
                  ) : (
                    <div className="px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 mt-6 whitespace-nowrap">
                      {group}
                    </div>
                  )}
                  {routesInGroup.map((route) => (
                    <SidebarItem
                      key={route.path}
                      to={route.path}
                      icon={React.createElement(route.icon, {
                        size: isSidebarCollapsed ? 22 : 18,
                      })}
                      label={t(route.name) || route.name}
                      isCollapsed={isSidebarCollapsed}
                      badge={
                        route.path === '/admin-users' && canReviewApplications
                          ? (pendingData?.count ?? 0)
                          : undefined
                      }
                      onClick={onMobileClose}
                    />
                  ))}
                </div>
              ),
            )}
          </nav>

          {/* Footer */}
          <div className="pt-4 mt-4 border-t border-gray-100 dark:border-white/5 space-y-1">
            {/* Collapse toggle — desktop only */}
            <button
              onClick={toggleSidebar}
              title={
                isSidebarCollapsed ? t('sidebar_expand') : t('sidebar_collapse')
              }
              className="hidden lg:flex w-full items-center gap-3 px-4 py-3 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 rounded-xl transition-colors"
            >
              {isSidebarCollapsed ? (
                <ChevronsRight size={18} />
              ) : (
                <ChevronsLeft size={18} />
              )}
              <motion.span
                animate={{
                  opacity: isSidebarCollapsed ? 0 : 1,
                  width: isSidebarCollapsed ? 0 : 'auto',
                  display: isSidebarCollapsed ? 'none' : 'block',
                }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden whitespace-nowrap text-sm"
              >
                {t('sidebar_collapse')}
              </motion.span>
            </button>

            {/* Logout — always visible */}
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              title={isSidebarCollapsed ? t('logout') : undefined}
              className={`w-full flex items-center gap-3 rounded-xl px-4 py-3 text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-50 ${isSidebarCollapsed ? 'justify-center' : ''}`}
            >
              <LogOut size={18} className="flex-shrink-0" />
              <motion.span
                animate={{
                  opacity: isSidebarCollapsed ? 0 : 1,
                  width: isSidebarCollapsed ? 0 : 'auto',
                  display: isSidebarCollapsed ? 'none' : 'block',
                }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden whitespace-nowrap text-sm font-medium"
              >
                {isLoggingOut ? t('header_loggingOut') : t('logout')}
              </motion.span>
            </button>

            {/* User info strip (expanded only) */}
            {!isSidebarCollapsed && userInfo && (
              <div className="px-4 py-2 mt-1 rounded-xl bg-gray-50 dark:bg-white/5">
                <p className="text-sm font-medium text-gray-800 dark:text-white truncate">
                  {displayName}
                </p>
                <p className="text-xs text-gray-400 truncate">
                  {t(getRoleI18nKey(userInfo.role)) || userInfo.role}
                </p>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Mobile overlay with AnimatePresence for exit animation */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            key="sidebar-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/50 z-30 lg:hidden"
            onClick={onMobileClose}
          />
        )}
      </AnimatePresence>
    </>
  );
};
