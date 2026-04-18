# 页面切换动画实现方案

## 📋 问题描述

目前 frontend-blog 应用在页面切换时没有任何动画效果，用户体验不够流畅。需要为 PC 和 H5 设备添加平滑的页面切换动画，同时确保兼容 SSR 水合过程，避免出现水合不匹配问题。

## 🎯 根因分析

### 当前状态

1. **无页面过渡动画**：页面切换是瞬间完成的，缺乏视觉连续性
2. **已有动画库**：项目中已安装 `framer-motion` 并在 `MobileSettingsDrawer` 中使用
3. **导航组件**：使用 next-intl 的 `Link` 组件，但无动画效果
4. **水合风险**：直接添加动画可能导致 SSR 与客户端渲染不匹配

### 技术约束

1. **Next.js 15 App Router**：需要兼容新的路由架构
2. **SSR/SSG 支持**：动画必须在服务器端渲染时安全降级
3. **国际化路由**：需要兼容 next-intl 的多语言路由
4. **性能要求**：动画不能影响 Lighthouse 性能分数

## ✅ 方案选型

### 方案对比

| 方案                       | 优点                         | 缺点                             | 适用场景     |
| -------------------------- | ---------------------------- | -------------------------------- | ------------ |
| **方案一：页面级过渡动画** | 实现简单，效果统一，水合安全 | 所有页面使用相同动画，缺乏个性化 | 主要页面切换 |
| **方案二：组件级动画**     | 灵活，可针对不同组件定制     | 实现复杂，需要更多代码           | 特定组件过渡 |
| **方案三：路由监听动画**   | 精确控制路由变化             | 需要管理动画状态，复杂度高       | 高级动画需求 |

### 选择方案一：页面级过渡动画

**理由**：

1. **实现简单**：只需创建一个 `PageTransition` 组件
2. **效果统一**：提供一致的页面切换体验
3. **水合安全**：容易实现条件渲染避免水合问题
4. **性能良好**：使用 `transform` 和 `opacity` 硬件加速属性

## 🏗️ 系统架构

### 整体设计

```
app/[locale]/layout.tsx
    └── main 区域
        └── PageTransition 组件 (包裹 children)
            └── 各页面内容
```

### 组件结构

1. **PageTransition**：核心动画组件，处理页面切换动画
2. **AnimatedLink**：增强的 Link 组件，提供点击反馈
3. **NavigationAnimation**：导航组件的活动状态动画

### 动画参数

- **进入动画**：从右侧滑入 (opacity: 0 → 1, x: 20 → 0)
- **退出动画**：向左侧滑出 (opacity: 1 → 0, x: 0 → -20)
- **时长**：300ms
- **缓动函数**：easeInOut

## 🔄 完整工作流程

### 页面切换流程

1. 用户点击导航链接
2. `AnimatedLink` 触发点击反馈动画
3. Next.js 开始加载新页面
4. 当前页面执行退出动画
5. 新页面执行进入动画
6. 动画完成后显示新页面内容

### 水合安全流程

1. 服务器端渲染时，`PageTransition` 直接渲染子内容
2. 客户端首次渲染时，检测是否为水合阶段
3. 水合阶段跳过动画，直接显示内容
4. 后续导航才启用动画

### 减少运动偏好支持

1. 检测 `prefers-reduced-motion` 媒体查询
2. 如果用户偏好减少运动，则禁用动画
3. 提供渐进增强体验

## ⚙️ 技术实现细节

### 1. PageTransition 组件实现

```tsx
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

  // 检测是否为水合阶段
  useEffect(() => {
    setIsClient(true);
  }, []);

  // 服务器端渲染和水合阶段：直接渲染内容
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

### 2. AnimatedLink 组件实现

```tsx
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

### 3. 减少运动偏好支持

```tsx
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

## 📊 成本与性能

### 性能影响

1. **首次内容绘制 (FCP)**：无影响（动画在水合后执行）
2. **最大内容绘制 (LCP)**：轻微影响（300ms 动画延迟）
3. **累积布局偏移 (CLS)**：无影响（动画使用 transform）
4. **首次输入延迟 (FID)**：无影响（动画不阻塞交互）

### 优化措施

1. **硬件加速**：使用 `transform` 和 `opacity` 属性
2. **will-change**：添加 `will-change: transform, opacity`
3. **动画合成**：确保动画在合成层运行
4. **资源预加载**：利用 Next.js 的 prefetch 功能

### 兼容性

1. **浏览器支持**：所有现代浏览器支持 CSS transform
2. **设备支持**：PC 和移动端均支持
3. **框架兼容**：完全兼容 Next.js 15 和 React 19

## 🚀 实施步骤

### 第一阶段：基础实现

1. 创建 `PageTransition` 组件
2. 更新 `app/[locale]/layout.tsx` 使用动画组件
3. 测试基本页面切换动画

### 第二阶段：导航增强

1. 创建 `AnimatedLink` 组件
2. 更新 `Header`、`Sidebar`、`BottomNavigation` 组件
3. 添加活动状态动画

### 第三阶段：优化与测试

1. 添加减少运动偏好支持
2. 性能测试（Lighthouse）
3. 跨设备测试
4. 水合测试

## ⚠️ 注意事项

### 水合安全

1. **条件渲染**：必须在 `useEffect` 后启用动画
2. **key 属性**：使用 `pathname` 作为动画 key
3. **AnimatePresence**：正确处理组件卸载

### 性能优化

1. **动画时长**：保持 300ms 以内
2. **缓动函数**：使用 `easeInOut` 提供自然感觉
3. **合成层**：确保动画在独立图层运行

### 可访问性

1. **减少运动**：尊重用户系统设置
2. **焦点管理**：动画后保持焦点位置
3. **屏幕阅读器**：确保动画不影响阅读器

## 📈 预期效果

### 用户体验提升

1. **视觉连续性**：页面切换更平滑自然
2. **感知性能**：用户感觉应用响应更快
3. **交互反馈**：导航操作有明确视觉反馈

### 技术指标

1. **Lighthouse 分数**：保持 90+ 分
2. **FCP**：无变化
3. **LCP**：增加 < 100ms
4. **CLS**：保持 0

## 🔧 部署指南

### 开发环境测试

1. 启动开发服务器：`yarn dev`
2. 访问 http://localhost:4002
3. 测试页面切换动画
4. 检查控制台错误

### 生产环境部署

1. 构建项目：`yarn build`
2. 检查构建输出
3. 部署到生产环境
4. 监控性能指标

### 回滚计划

如果动画导致问题：

1. 移除 `PageTransition` 组件包装
2. 恢复原始 `Link` 组件
3. 重新部署

## 📚 相关文档

1. [Framer Motion 文档](https://www.framer.com/motion/)
2. [Next.js 路由过渡](https://nextjs.org/docs/app/building-your-application/routing/linking-and-navigating)
3. [Web 动画性能指南](https://web.dev/animations/)
4. [减少运动偏好指南](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)

---

**最后更新**: 2026-04-18  
**负责人**: 前端开发团队  
**状态**: 待实施
