import type { Metadata } from 'next';
import React, { Suspense } from 'react';
import { AiPromptDetailClient } from '@/components/ai-prompt/AiPromptDetailClient';
import { PageSkeleton } from '@/components/ui/PageSkeleton';

export const metadata: Metadata = { title: 'AI Prompt Detail' };

export default function AiPromptDetailPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AiPromptDetailClient />
    </Suspense>
  );
}
