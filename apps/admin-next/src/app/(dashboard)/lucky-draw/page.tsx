import type { Metadata } from 'next';
import React, { Suspense } from 'react';
import { LuckyDrawManagement } from '@/components/lucky-draw/LuckyDrawClient';
import { PageSkeleton } from '@/components/ui/PageSkeleton';

export const metadata: Metadata = { title: 'Lucky Draw' };

export default function LuckyDrawPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LuckyDrawManagement />
    </Suspense>
  );
}
