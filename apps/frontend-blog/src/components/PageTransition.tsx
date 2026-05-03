'use client';

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { usePathname } from 'next/navigation';
import {
  getNavDirection,
  initPopStateDetection,
  type NavDirection,
} from '@/lib/navigation/direction';

interface PageTransitionProps {
  children: React.ReactNode;
}

// iOS/Android 导航感：轻微位移 + 淡入，不宜过大避免晕感
const SLIDE_PX = 28;

// 根据方向生成进出场动画参数
function getVariants(dir: NavDirection) {
  const sign = dir === 'forward' ? 1 : -1;
  return {
    initial: { opacity: 0, x: sign * SLIDE_PX },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -sign * SLIDE_PX },
  };
}

/**
 * 页面切换动画 — 方向感知滑动 + 淡入淡出
 *
 * 前进（卡片 → 文章详情）：从右侧滑入
 * 后退（返回按钮 / 浏览器后退）：从左侧滑入
 *
 * 关键设计：
 * 1. DOM 结构 SSR/CSR 始终一致，避免 hydration mismatch
 * 2. shouldAnimate === false 时 motionProps 为空，motion.div 退化为普通 div
 * 3. dirRef 在渲染阶段同步捕获方向，确保 pathname 变化瞬间方向正确
 * 4. initPopStateDetection 监听浏览器后退/前进按钮
 * 5. 后退到首页时跳过动画（首页已通过 Context 保留数据，无需动画过渡）
 */
export function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname();
  // SSR 返回 null，CSR 返回 boolean
  const prefersReducedMotion = useReducedMotion();

  // 在 pathname 变化时同步捕获导航方向（渲染阶段，非 effect）
  const dirRef = useRef<NavDirection>('forward');
  const prevPathRef = useRef(pathname);
  if (prevPathRef.current !== pathname) {
    dirRef.current = getNavDirection();
    prevPathRef.current = pathname;
  }

  // 注册浏览器后退/前进按钮检测（挂载一次，direction.ts 内有重复注册防护）
  useEffect(() => {
    initPopStateDetection();
  }, []);

  // null（SSR）或 true（用户偏好减少运动）时不播放动画
  const shouldAnimate = prefersReducedMotion === false;
  const variants = getVariants(dirRef.current);

  // 关键：始终传入 animate: {opacity:1, x:0}，确保 SSR 和 CSR hydration
  // 渲染的 style 完全一致（都是 {opacity:1, transform:"none"}），避免 hydration mismatch。
  // 不传 animate 时，SSR 渲染 style={}，而 CSR 渲染 style={opacity:1,transform:"none"}，产生不一致。
  //
  // P0-4 修复：后退到首页时跳过动画。
  // 首页已通过 HomePageStateProvider Context 保留了文章数据和滚动位置，
  // 播放动画会让用户感觉页面在"重新渲染"。
  // 检测到 dirRef.current === 'backward' 且目标路径是首页时，使用无动画的 motionProps。
  const isBackToHome =
    dirRef.current === 'backward' &&
    pathname.split('/').filter(Boolean).length <= 1;
  const motionProps =
    shouldAnimate && !isBackToHome
      ? {
          initial: variants.initial,
          animate: variants.animate,
          exit: variants.exit,
          // iOS cubic-bezier：快速响应，柔和减速，贴近原生 push 动画
          transition: {
            duration: 0.22,
            ease: [0.25, 0.46, 0.45, 0.94] as const,
          },
        }
      : {
          // 无动画时也传入 animate+initial，保证 SSR style 与 CSR 一致
          initial: { opacity: 1, x: 0 },
          animate: { opacity: 1, x: 0 },
        };

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        className="min-h-screen bg-background"
        {...motionProps}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
