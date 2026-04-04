'use client';

/**
 * FinanceRefreshButton — Client Component
 * Stage 4 要点：Server Component 数据更新靠 router.refresh()，
 * 它通知 Next.js 重新执行所有 async Server Component，无需整页跳转。
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RefreshCcw } from 'lucide-react';

export function FinanceRefreshButton() {
  const router = useRouter();
  const [spinning, setSpinning] = useState(false);

  const handleRefresh = () => {
    setSpinning(true);
    router.refresh(); // 让 Next.js 重新渲染所有 Server Components
    // router.refresh() 是同步触发，无法 await；用 300ms 视觉反馈
    setTimeout(() => setSpinning(false), 800);
  };

  return (
    <button
      onClick={handleRefresh}
      className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-sm text-slate-300 transition-all hover:text-white"
    >
      <RefreshCcw size={14} className={spinning ? 'animate-spin' : ''} />
      Refresh Data
    </button>
  );
}
