import React, { Suspense } from 'react';
import {
  HydrationBoundary,
  QueryClient,
  dehydrate,
} from '@tanstack/react-query';
import { getTranslations } from 'next-intl/server';
import { SupportChannels } from '@/components/support-channels/SupportChannelsClient';
import { PageSkeleton } from '@/components/ui/PageSkeleton';
import { serverGet } from '@/lib/serverFetch';
import type { SupportChannelsResult } from '@/type/types';

interface SupportChannelsPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: SupportChannelsPageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'supportChannels' });
  return {
    title: t('pageTitle'),
  };
}

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
