import type { Metadata } from 'next';
import React, { Suspense } from 'react';
import { AiPromptClient } from '@/components/ai-prompt/AiPromptClient';
import { PageSkeleton } from '@/components/ui/PageSkeleton';

export const metadata: Metadata = { title: 'AI Prompt Management' };

export default function AiPromptPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AiPromptClient />
    </Suspense>
  );
}
