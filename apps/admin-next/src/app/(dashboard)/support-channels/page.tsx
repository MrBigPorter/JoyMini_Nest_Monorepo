import type { Metadata } from 'next';
import React, { Suspense } from 'react';
import {
  HydrationBoundary,
  QueryClient,
  dehydrate,
} from '@tanstack/react-query';
import { SupportChannels } from '@/components/support-channels/SupportChannelsClient';
import { PageSkeleton } from '@/components/ui/PageSkeleton';
import { serverGet } from '@/lib/serverFetch';
import type { SupportChannelsResult } from '@/type/types';

export const metadata: Metadata = {
  title: 'Support Channels',
};

export default async function SupportChannelsPage() {
  const initialQuery = {
    page: 1,
    pageSize: 20,
  };
  const queryClient = new QueryClient();

  await queryClient.prefetchQuery({
    queryKey: ['support-channels', 1, 20, '', 'all'],
    queryFn: async () => {
      return serverGet<SupportChannelsResult>(
        '/v1/admin/support-channels',
        initialQuery,
        {
          revalidate: 30,
          tags: ['support-channels:list'],
        },
      );
    },
  });

  return (
    <Suspense fallback={<PageSkeleton />}>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <SupportChannels />
      </HydrationBoundary>
    </Suspense>
  );
}
