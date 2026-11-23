import type { Metadata } from 'next';
import React, { Suspense } from 'react';
import { KbCandidatesClient } from '@/components/kb-candidates/KbCandidatesClient';
import { PageSkeleton } from '@/components/ui/PageSkeleton';

export const metadata: Metadata = { title: 'KB Candidates' };

export default function KbCandidatesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <KbCandidatesClient />
    </Suspense>
  );
}
