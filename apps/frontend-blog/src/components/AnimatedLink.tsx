'use client';

import { Link } from '@/navigation';
import { ComponentProps } from 'react';
import { motion } from 'framer-motion';

type LinkProps = ComponentProps<typeof Link>;

interface AnimatedLinkProps extends LinkProps {
  children: React.ReactNode;
  className?: string;
  /**
   * 是否显示点击反馈动画
   * @default true
   */
  showTapFeedback?: boolean;
  /**
   * 是否显示悬停反馈动画
   * @default true
   */
  showHoverFeedback?: boolean;
  /**
   * 点击时的缩放比例
   * @default 0.95
   */
  tapScale?: number;
  /**
   * 悬停时的缩放比例
   * @default 1.05
   */
  hoverScale?: number;
}

/**
 * 增强的动画链接组件
 *
 * 特性：
 * 1. 点击反馈：点击时轻微缩放
 * 2. 悬停反馈：悬停时轻微放大
 * 3. 水合安全：使用客户端状态管理
 * 4. 兼容 next-intl：保持国际化支持
 *
 * 使用示例：
 * ```tsx
 * <AnimatedLink href="/articles" className="text-primary">
 *   查看文章
 * </AnimatedLink>
 * ```
 */
export function AnimatedLink({
  children,
  className = '',
  showTapFeedback = true,
  showHoverFeedback = true,
  tapScale = 0.95,
  hoverScale = 1.05,
  ...props
}: AnimatedLinkProps) {
  // 构建动画配置
  const animationProps = {
    ...(showHoverFeedback && { whileHover: { scale: hoverScale } }),
    ...(showTapFeedback && { whileTap: { scale: tapScale } }),
  };

  return (
    <motion.div
      initial={false} // 关键：禁止初始动画，统一 SSR/CSR
      {...animationProps}
      style={{
        cursor: 'pointer',
        willChange: 'transform',
      }}
      suppressHydrationWarning // 压制 hydration 警告
    >
      <Link className={className} {...props}>
        {children}
      </Link>
    </motion.div>
  );
}

/**
 * 导航链接组件（带活动状态指示器）
 *
 * 适用于导航菜单，提供活动状态视觉反馈
 */
interface NavLinkProps extends AnimatedLinkProps {
  isActive?: boolean;
  activeClassName?: string;
}

export function NavLink({
  isActive = false,
  activeClassName = 'text-primary font-medium',
  className = '',
  children,
  href,
  ...props
}: NavLinkProps) {
  const finalClassName = isActive
    ? `${className} ${activeClassName}`
    : className;

  return (
    <AnimatedLink
      href={href}
      className={finalClassName}
      tapScale={0.97}
      hoverScale={1.03}
      {...props}
    >
      {children}
    </AnimatedLink>
  );
}
