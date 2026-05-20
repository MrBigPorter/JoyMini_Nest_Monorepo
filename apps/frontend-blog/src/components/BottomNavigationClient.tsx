'use client';

/**
 * BottomNavigation 的客户端包装层
 *
 * 为什么用 dynamic + ssr: false：
 * BottomNavigation 内部通过 useAuth → useAuthStore (Zustand persist + cookie) 消费
 * 客户端存储状态。platform.ts 的模块级常量（isServer/isClient）在 server bundle 和
 * client bundle 初始化时机不同，导致 persist 中间件 hydration 阶段产生 render 差异，
 * 进而引发 "server rendered HTML didn't match the client" hydration mismatch。
 *
 * BottomNavigation 是 md:hidden 的移动端专用导航，不含 SEO 内容，
 * 无需 SSR，使用 ssr: false 彻底规避 server/client 不一致问题。
 *
 * loading 骨架与组件等高，防止 main 底部 padding 引起布局跳变。
 */
import dynamic from 'next/dynamic';

const BottomNavigation = dynamic(
  () => import('@/components/BottomNavigation'),
  {
    ssr: false,
    loading: () => (
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border">
        <div className="h-14" />
      </nav>
    ),
  },
);

export default function BottomNavigationClient() {
  return <BottomNavigation />;
}
