import type { Metadata } from 'next';
import React, { Suspense } from 'react';
import { KnowledgeBaseClient } from '@/components/knowledge/KnowledgeBaseClient';
import { PageSkeleton } from '@/components/ui/PageSkeleton';

export const metadata: Metadata = { title: 'Knowledge Base' };

export default function KnowledgeBasePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <KnowledgeBaseClient />
    </Suspense>
  );
}
