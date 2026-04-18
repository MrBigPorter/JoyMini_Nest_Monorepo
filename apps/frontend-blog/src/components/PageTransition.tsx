'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { usePathname } from 'next/navigation';

interface PageTransitionProps {
  children: React.ReactNode;
}

/**
 * 页面切换动画组件
 *
 * 特性：
 * 1. 水合安全：服务器端渲染和水合阶段跳过动画
 * 2. 减少运动偏好支持：尊重用户系统设置
 * 3. 硬件加速：使用 transform 和 opacity 属性
 * 4. 路由感知：使用 pathname 作为动画 key
 *
 * 动画参数：
 * - 进入：从右侧滑入 (opacity: 0 → 1, x: 20 → 0)
 * - 退出：向左侧滑出 (opacity: 1 → 0, x: 0 → -20)
 * - 时长：300ms
 * - 缓动：easeInOut
 */
export function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname();
  const [isClient, setIsClient] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  // 检测是否为水合阶段
  useEffect(() => {
    setIsClient(true);
  }, []);

  // 服务器端渲染和水合阶段：直接渲染内容
  if (!isClient) {
    return <>{children}</>;
  }

  // 用户偏好减少运动：禁用动画
  if (prefersReducedMotion) {
    return <>{children}</>;
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{
          duration: 0.3,
          ease: 'easeInOut',
          opacity: { duration: 0.2 },
        }}
        className="min-h-full"
        style={{ willChange: 'transform, opacity' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * 安全动画 Hook
 *
 * 返回根据用户偏好调整的动画参数
 * 用于需要自定义动画的场景
 */
export function useSafeAnimation() {
  const prefersReducedMotion = useReducedMotion();

  return {
    initial: prefersReducedMotion ? {} : { opacity: 0, x: 20 },
    animate: prefersReducedMotion ? {} : { opacity: 1, x: 0 },
    exit: prefersReducedMotion ? {} : { opacity: 0, x: -20 },
    transition: prefersReducedMotion
      ? {}
      : {
          duration: 0.3,
          ease: 'easeInOut',
          opacity: { duration: 0.2 },
        },
  };
}
