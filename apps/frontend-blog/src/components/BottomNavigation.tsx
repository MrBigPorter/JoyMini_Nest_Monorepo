'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname } from '@/navigation';
import { getIsActive } from '@/lib/utils/navigation';
import { NavLink } from '@/components/AnimatedLink';
import { motion } from 'framer-motion';
import { ProtectedLink } from '@/components/auth/ProtectedLink';

export default function BottomNavigation() {
  const t = useTranslations();
  const pathname = usePathname();
  const [activeStates, setActiveStates] = useState<Record<string, boolean>>({});
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);

    // 在客户端计算所有导航项的激活状态
    const newActiveStates: Record<string, boolean> = {};
    const navItems = [
      {
        href: '/',
        labelKey: 'common.home',
        icon: (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 0 0 1 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
            />
          </svg>
        ),
      },
      {
        href: '/categories',
        labelKey: 'common.categories',
        icon: (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
            />
          </svg>
        ),
      },
      {
        href: '/tags',
        labelKey: 'common.tags',
        icon: (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
            />
          </svg>
        ),
      },
      {
        href: '/bookmarks',
        labelKey: 'common.bookmarks',
        protected: true,
        icon: (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
            />
          </svg>
        ),
      },
      {
        href: '/about',
        labelKey: 'common.about',
        icon: (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
        ),
      },
    ];

    navItems.forEach((item) => {
      newActiveStates[item.href] = getIsActive(pathname, item.href);
    });

    setActiveStates(newActiveStates);
  }, [pathname]);

  // 水合完成前渲染同等高度的空壳，避免 main 区域 padding-bottom 在动画中跳变
  if (!isClient) {
    return (
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border">
        <div className="h-14" />
        {/* 安全区域占位：必须在 nav items 之后，填充 Home Indicator 区域 */}
        <div style={{ height: 'var(--safe-area-bottom)' }} />
        {/* iOS Safari toolbar 收起时背景兜底：向下延伸覆盖 home indicator 白边 */}
        <div className="absolute bottom-0 left-0 right-0 h-[100px] bg-background translate-y-full pointer-events-none" />
      </nav>
    );
  }

  const navItems = [
    {
      href: '/',
      labelKey: 'common.home',
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 0 0 1 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
          />
        </svg>
      ),
    },
    {
      href: '/categories',
      labelKey: 'common.categories',
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
        </svg>
      ),
    },
    {
      href: '/tags',
      labelKey: 'common.tags',
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
          />
        </svg>
      ),
    },
    {
      href: '/bookmarks',
      labelKey: 'common.bookmarks',
      protected: true,
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
          />
        </svg>
      ),
    },
    {
      href: '/about',
      labelKey: 'common.about',
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
          />
        </svg>
      ),
    },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border">
      {/* 实际导航内容 */}
      <div className="h-14 px-4 flex items-center justify-around">
        {navItems.map((item) => {
          const isActive = activeStates[item.href] || false;

          // 受保护路由使用ProtectedLink，普通路由使用NavLink
          if (item.protected) {
            return (
              <ProtectedLink
                key={item.href}
                href={item.href}
                className="flex flex-col items-center justify-center h-full relative"
              >
                <div className="flex flex-col items-center justify-center">
                  <div className="relative">
                    {item.icon}
                    {isActive && (
                      <motion.div
                        layoutId="bottom-nav-active"
                        className="absolute -inset-2 rounded-full bg-primary/10"
                        transition={{
                          type: 'spring',
                          stiffness: 500,
                          damping: 30,
                        }}
                      />
                    )}
                  </div>
                  <span
                    className={`text-xs mt-1 transition-colors ${
                      isActive
                        ? 'text-primary font-medium'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {t(item.labelKey)}
                  </span>
                </div>
              </ProtectedLink>
            );
          }

          return (
            <NavLink
              key={item.href}
              href={item.href}
              className="flex flex-col items-center justify-center flex-1 h-full relative"
              // P1-2 修复：非首页链接禁用自动 prefetch
              // 原因：BottomNav 始终在视口内，Next.js 默认对视口内 Link 自动 prefetch
              //       导致 categories/tags/about 在首页加载时立即触发 ISR revalidation
              //       形成并发 ISR 风暴（日志中 t=10.67s 的 4 个 10s+ rpc default.revalidate）
              // 首页链接 (href='/') 保持默认 prefetch，从其他页返回首页时有收益
              prefetch={item.href === '/' ? undefined : false}
            >
              <div className="flex flex-col items-center justify-center">
                <div className="relative">
                  {item.icon}
                  {isActive && (
                    <motion.div
                      layoutId="bottom-nav-active"
                      className="absolute -inset-2 rounded-full bg-primary/10"
                      transition={{
                        type: 'spring',
                        stiffness: 500,
                        damping: 30,
                      }}
                    />
                  )}
                </div>
                <span
                  className={`text-xs mt-1 transition-colors ${
                    isActive
                      ? 'text-primary font-medium'
                      : 'text-muted-foreground'
                  }`}
                >
                  {t(item.labelKey)}
                </span>
              </div>
            </NavLink>
          );
        })}
      </div>
      {/* 安全区域占位：必须在 nav items 之后，填充 Home Indicator 区域 */}
      <div style={{ height: 'var(--safe-area-bottom)' }} />
      {/* iOS Safari toolbar 收起时背景兜底：
          toolbar 收起动画中 env(safe-area-inset-bottom) 仍报 0px，
          viewport 已向下扩展至 home indicator 区域但 spacer=0 → 白边。
          此挡板将 nav 背景向下延伸 100px，彻底覆盖过渡期白边。
          translate-y-full 推到 nav 底边之下，pointer-events-none 不影响交互。 */}
      <div className="absolute bottom-0 left-0 right-0 h-[100px] bg-background translate-y-full pointer-events-none" />
    </nav>
  );
}
