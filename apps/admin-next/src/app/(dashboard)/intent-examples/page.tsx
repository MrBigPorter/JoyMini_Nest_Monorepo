import type { Metadata } from 'next';
import React, { Suspense } from 'react';
import { IntentExamplesClient } from '@/components/intent-examples/IntentExamplesClient';
import { PageSkeleton } from '@/components/ui/PageSkeleton';

export const metadata: Metadata = { title: 'Intent Examples' };

export default function IntentExamplesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <IntentExamplesClient />
    </Suspense>
  );
}
