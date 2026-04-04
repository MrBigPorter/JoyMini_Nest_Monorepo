import type { Metadata } from 'next';
import React, { Suspense } from 'react';
import { FlashSaleManagement } from '@/components/flash-sale/FlashSaleClient';
import { PageSkeleton } from '@/components/ui/PageSkeleton';

export const metadata: Metadata = { title: 'Flash Sale' };

export default function FlashSalePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <FlashSaleManagement />
    </Suspense>
  );
}
