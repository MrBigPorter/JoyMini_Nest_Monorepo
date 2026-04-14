'use client';

import dynamic from 'next/dynamic';

// 客户端组件中动态导入翻译进度卡片
const TranslationProgressCard = dynamic(
  () => import('@/views/blog/components/TranslationProgressCard'),
  { ssr: false },
);

export default function TranslationProgressCardWrapper() {
  return <TranslationProgressCard />;
}
