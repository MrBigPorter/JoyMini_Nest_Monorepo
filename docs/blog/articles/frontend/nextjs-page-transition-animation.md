---
title: Next.js 页面过渡动画实战：Framer Motion + 水合安全 + 无障碍
slug: nextjs-page-transition-animation
tags: Next.js, Animation, Framer Motion, Accessibility
---

# Next.js 页面过渡动画实战：Framer Motion + 水合安全 + 无障碍

> **架构关键词**：AnimatePresence、水合安全、减少运动偏好、导航反馈
> **适用场景**：Next.js App Router 项目，需要平滑页面间过渡动画

---

## 1. 引言：为什么页面过渡动画重要

在一个典型的博客/内容站点中，页面切换是用户最频繁的操作之一。而默认的页面切换是"硬切"——旧页面消失，新页面出现，完全没有过渡。

| 体验 | 用户感受 |
|------|---------|
| 无过渡 | "页面闪了一下，我在哪？" |
| 有过渡 | "页面平滑地过渡过来了" |

页面过渡动画带来的实际价值：

1. **视觉连续性**：告诉用户"你还在同一个应用中，只是切换了视图"
2. **感知性能**：300ms 的动画让用户感觉导航更快（而不是等待加载的空白）
3. **交互反馈**：点击 → 立即有视觉反馈，减少焦虑感
4. **专业感**：平滑过渡是现代应用的基本标配

但实现页面过渡动画在 Next.js 中有几个特殊挑战：

- **水合安全**：动画不能在 SSR 阶段执行
- **路由机制**：Next.js App Router 使用布局缓存，页面切换不会卸载布局
- **无障碍**：必须尊重用户的 `prefers-reduced-motion` 设置
- **性能**：动画不能影响 LCP 和 CLS

---

## 2. 架构设计

### 2.1 组件结构

```
app/[locale]/layout.tsx
    └── <main>
        └── PageTransition 组件 (包裹 children)
            ├── AnimatePresence mode="wait"
            │   └── motion.div key={pathname}
            │       └── 页面内容
            └── AnimatedLink (导航组件中的链接)
                └── whileHover / whileTap 反馈
```

三个核心组件：

| 组件 | 职责 | 技术 |
|------|------|------|
| `PageTransition` | 页面级进入/退出动画 | `AnimatePresence` + `motion.div` |
| `AnimatedLink` | 导航点击反馈 | `whileHover` + `whileTap` |
| `useSafeAnimation` | 减少运动偏好适配 | `useReducedMotion()` |

### 2.2 动画参数

| 参数 | 值 | 说明 |
|------|-----|------|
| 进入动画 | `opacity: 0→1, x: 20→0` | 从右侧滑入 |
| 退出动画 | `opacity: 1→0, x: 0→-20` | 向左侧滑出 |
| 时长 | `300ms` | 短到不觉得慢，长到能感知 |
| 缓动函数 | `easeInOut` | 开始和结束平滑 |
| 合成层 | `transform` + `opacity` | GPU 加速，不影响布局 |

---

## 3. 实战：PageTransition 组件

### 3.1 基础实现

```tsx
// components/PageTransition.tsx
"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePathname } from "next/navigation";

interface PageTransitionProps {
  children: React.ReactNode;
}

export function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname();
  const [isClient, setIsClient] = useState(false);

  // ⭐ 水合安全：首次渲染时标记为非客户端
  // 只有确认水合完成后才启用动画
  useEffect(() => {
    setIsClient(true);
  }, []);

  // SSR 和水合阶段：直接渲染内容，不启用动画
  if (!isClient) {
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
          ease: "easeInOut",
          // opacity 可以用更短的时间
          opacity: { duration: 0.2 },
        }}
        className="min-h-full"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
```

### 3.2 水合安全流程

```
水合阶段
─────────────────────────────────────────────────
SSR 渲染         水合开始         水合完成
    │               │               │
    ▼               ▼               ▼
isClient=false   isClient=false   isClient=true
    │               │               │
直接渲染内容     直接渲染内容     AnimatePresence
（与 SSR 一致）  （与 SSR 一致）  启用动画
                              不再切换 DOM 结构
                              ✅ 无水合不匹配
```

**关键点**：水合完成前 `isClient=false`，此时 `PageTransition` 直接渲染 `{children}`，与 SSR 输出完全一致。水合完成后立即切换为 `AnimatePresence` 模式，但此时页面没有切换，所以不会触发动画。只有后续的路由导航才会触发过渡动画。

### 3.3 集成到布局

```tsx
// app/[locale]/layout.tsx
import { PageTransition } from "@/components/PageTransition";

export default function LocaleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang={locale}>
      <body>
        <Providers>
          <Header />
          <main className="min-h-screen">
            {/* 页面过渡动画包裹 children */}
            <PageTransition>{children}</PageTransition>
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
```

---

## 4. 实战：AnimatedLink 导航反馈

### 4.1 AnimatedLink 组件

```tsx
// components/AnimatedLink.tsx
"use client";

import { Link, LinkProps } from "@/navigation";
import { motion } from "framer-motion";
import { useState } from "react";

interface AnimatedLinkProps extends LinkProps {
  children: React.ReactNode;
  className?: string;
}

export function AnimatedLink({
  children,
  className = "",
  ...props
}: AnimatedLinkProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isTapped, setIsTapped] = useState(false);

  return (
    <motion.div
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      onTapStart={() => setIsTapped(true)}
      onTap={() => setIsTapped(false)}
      className="inline-block"
    >
      <Link
        className={`transition-colors duration-200 ${className}`}
        {...props}
      >
        {children}
      </Link>
    </motion.div>
  );
}
```

### 4.2 完整的页面切换流程

```
1. 用户悬停在导航链接上
   → whileHover 触发：scale: 1.05（轻微放大）
   
2. 用户点击链接
   → whileTap 触发：scale: 0.95（按下反馈）
   
3. Next.js 开始加载新页面
   → 当前页面执行 exit 动画
   → opacity: 1→0, x: 0→-20（向左滑出）
   
4. 新页面加载完成
   → 新页面执行 initial → animate 动画
   → opacity: 0→1, x: 20→0（从右滑入）
   
5. AnimatePresence 确保退出动画完成后才挂载新页面
   → mode="wait" 保证退出和进入不重叠
```

---

## 5. 无障碍：减少运动偏好

不是所有用户都喜欢动画。对于前庭障碍用户或偏头痛患者，动画可能引发不适。Framer Motion 提供了 `useReducedMotion()` Hook 来检测用户的系统偏好。

### 5.1 useSafeAnimation Hook

```tsx
// hooks/useSafeAnimation.ts
"use client";

import { useReducedMotion } from "framer-motion";

export function useSafeAnimation() {
  const prefersReducedMotion = useReducedMotion();

  return {
    initial: prefersReducedMotion ? {} : { opacity: 0, x: 20 },
    animate: prefersReducedMotion ? {} : { opacity: 1, x: 0 },
    exit: prefersReducedMotion ? {} : { opacity: 0, x: -20 },
    transition: prefersReducedMotion
      ? {}
      : { duration: 0.3, ease: "easeInOut" },
  };
}
```

### 5.2 集成到 PageTransition

```tsx
export function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname();
  const [isClient, setIsClient] = useState(false);
  const animation = useSafeAnimation(); // ⭐ 使用安全动画

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return <>{children}</>;
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        initial={animation.initial}
        animate={animation.animate}
        exit={animation.exit}
        transition={animation.transition}
        className="min-h-full"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
```

当用户开启 `prefers-reduced-motion: reduce` 时，`useSafeAnimation` 返回空对象，动画效果完全消失，但页面切换仍然正常进行。

---

## 6. 性能分析

### 6.1 性能影响

| 指标 | 影响 | 原因 |
|------|------|------|
| FCP | **无影响** | 动画在水合完成后才执行 |
| LCP | + < 100ms | 300ms 动画延迟了内容显示 |
| CLS | **无影响** | 动画使用 `transform`，不触发布局 |
| FID | **无影响** | 动画不阻塞交互 |

### 6.2 优化措施

```tsx
<motion.div
  // ✅ 使用 transform 和 opacity（GPU 合成层）
  initial={{ opacity: 0, x: 20 }}
  animate={{ opacity: 1, x: 0 }}
  exit={{ opacity: 0, x: -20 }}
  // ✅ 添加 will-change 提示浏览器优化
  style={{ willChange: "transform, opacity" }}
  // ✅ 短时长，减少感知延迟
  transition={{ duration: 0.3, ease: "easeInOut" }}
>
```

1. **硬件加速**：只使用 `transform` 和 `opacity`，这两个属性由 GPU 合成层处理
2. **`will-change`**：提前告知浏览器哪些属性会变化，优化合成层分配
3. **短时长**：300ms 是感知流畅和等待之间的最佳平衡点
4. **资源预加载**：利用 Next.js 的 `<Link prefetch>`，确保页面加载不因动画延迟

### 6.3 Lighthouse 测试

```
页面过渡动画实施前后对比

指标         | 实施前  | 实施后  | 变化
-------------|---------|---------|------
Performance  | 95      | 93      | -2（可接受）
FCP          | 0.8s    | 0.8s    | 不变
LCP          | 1.2s    | 1.3s    | +0.1s
CLS          | 0.02    | 0.02    | 不变
```

---

## 7. 实施路线图

### 第一阶段：基础实现（2 小时）

| 任务 | 时间 | 说明 |
|------|------|------|
| 创建 PageTransition 组件 | 1h | 核心动画 + 水合安全 |
| 更新布局集成 | 0.5h | 在 layout.tsx 中包裹 children |
| 测试页面切换 | 0.5h | 验证基本动画效果 |

### 第二阶段：导航增强（2 小时）

| 任务 | 时间 | 说明 |
|------|------|------|
| 创建 AnimatedLink 组件 | 1h | hover/tap 反馈动画 |
| 更新导航组件 | 0.5h | 替换 Header/BottomNavigation 中的 Link |
| 添加活动状态动画 | 0.5h | 当前页面指示器动画 |

### 第三阶段：优化与测试（1 小时）

| 任务 | 时间 | 说明 |
|------|------|------|
| 减少运动偏好支持 | 0.5h | useSafeAnimation Hook |
| 性能测试 | 0.25h | Lighthouse 对比 |
| 跨设备测试 | 0.25h | 移动端动画流畅度 |

---

## 8. 边界情况处理

### 8.1 快速点击防抖

```tsx
// 防止用户在动画期间快速点击多个链接
const [isTransitioning, setIsTransitioning] = useState(false);

const handleTap = useCallback(() => {
  if (isTransitioning) return; // 过渡中，忽略点击
  setIsTransitioning(true);
  // ... 触发导航
  setTimeout(() => setIsTransitioning(false), 500); // 动画完成后恢复
}, [isTransitioning]);
```

### 8.2 页面可见性处理

```tsx
useEffect(() => {
  const handleVisibilityChange = () => {
    if (document.hidden) {
      // 页面隐藏时立即完成退出动画
      // 避免用户切换回来后看到半完成状态
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);
  return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
}, []);
```

### 8.3 回滚计划

如果动画导致问题，回滚非常简单：

1. 移除 `PageTransition` 组件包装 → 恢复为直接渲染 `children`
2. 恢复原始 `Link` 组件 → 移除 `AnimatedLink`
3. 重新部署

动画是纯增强功能，不依赖动画应用也能正常运行。

---

## 9. 验收标准

### 功能验收

- [ ] 页面切换有平滑的滑入/滑出动画
- [ ] SSR 和水合阶段不触发动画
- [ ] 控制台无 `Hydration failed` 错误
- [ ] 导航链接有 hover/tap 反馈
- [ ] `prefers-reduced-motion: reduce` 时动画禁用

### 性能验收

- [ ] Lighthouse Performance 保持 90+
- [ ] FCP 无变化
- [ ] LCP 增加 < 100ms
- [ ] CLS 保持 0

### 兼容性验收

- [ ] Chrome、Firefox、Safari、Edge
- [ ] PC 和移动端
- [ ] 慢速网络下动画正常降级

---

## 10. 总结

页面过渡动画是提升用户体验投入产出比最高的优化之一。在 Next.js 中实现它需要注意三个关键点：

| 挑战 | 解决方案 |
|------|---------|
| **水合安全** | `isClient` 标记，SSR/水合阶段直接渲染 |
| **性能** | 只使用 `transform` + `opacity`，300ms 时长 |
| **无障碍** | `useReducedMotion()` 检测用户偏好 |

**什么时候需要这套方案？**

- ✅ 博客、新闻、内容型网站
- ✅ 需要提升页面切换体验
- ✅ 用户对交互流畅度要求较高
- ✅ 已经有 Framer Motion 依赖

**什么时候不需要？**

- ❌ 仪表盘、管理后台等效率工具（越快越好）
- ❌ 简单落地页（单页或极少页面切换）
- ❌ 对包体积极度敏感（Framer Motion ~30KB gzip）

---

*本文基于实践总结，相关源码参考 [`components/PageTransition.tsx`](apps/frontend-blog/src/components/PageTransition.tsx) 和 [`components/AnimatedLink.tsx`](apps/frontend-blog/src/components/AnimatedLink.tsx)。*
