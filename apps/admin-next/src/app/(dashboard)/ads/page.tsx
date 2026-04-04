import type { Metadata } from 'next';
import React, { Suspense } from 'react';
import { AdsManagement } from '@/components/ads/AdsManagementClient';
import { PageSkeleton } from '@/components/ui/PageSkeleton';

export const metadata: Metadata = { title: 'Ads Management' };

export default function AdsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AdsManagement />
    </Suspense>
  );
}
