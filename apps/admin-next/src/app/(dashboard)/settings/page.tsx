import type { Metadata } from 'next';
import React, { Suspense } from 'react';
import { SystemConfig } from '@/components/settings/SettingsClient';
import { PageSkeleton } from '@/components/ui/PageSkeleton';
import { serverGet } from '@/lib/serverFetch';
import type { SystemConfigItem } from '@/type/types';

export const metadata: Metadata = { title: 'System Settings' };

interface SystemConfigListResult {
  list: SystemConfigItem[];
}

export default async function SettingsPage() {
  let initialData: SystemConfigListResult | undefined;

  try {
    initialData = await serverGet<SystemConfigListResult>(
      '/v1/admin/system-config',
      undefined,
      {
        revalidate: 60,
        tags: ['system-config:list'],
      },
    );
  } catch {
    // 预取失败时退回客户端请求
    initialData = undefined;
  }

  return (
    <Suspense fallback={<PageSkeleton rows={4} />}>
      <SystemConfig initialData={initialData} />
    </Suspense>
  );
}
