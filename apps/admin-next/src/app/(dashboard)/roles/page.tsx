/**
 * Roles Page — Server Component
 * RBAC 角色权限管理界面
 */
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Roles & Permissions' };

import React, { Suspense } from 'react';
import { RolesClient } from '@/components/roles/RolesClient';

function RolesPageSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-16 w-80 rounded-xl bg-gray-100 dark:bg-white/5" />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-44 rounded-2xl bg-gray-100 dark:bg-white/5"
          />
        ))}
      </div>
    </div>
  );
}

export default function RolesPage() {
  return (
    <Suspense fallback={<RolesPageSkeleton />}>
      <RolesClient />
    </Suspense>
  );
}
