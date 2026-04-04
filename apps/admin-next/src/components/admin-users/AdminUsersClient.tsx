'use client';

/**
 * AdminUsersClient — Client Component
 * Phase 3: URL searchParams 驱动 filter
 */
import React, { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AdminUserManagement } from './AdminUserManagementClient';

export function AdminUsersClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── URL → 初始 filter 参数 ──────────────────────────────────
  const urlFilterParams = useMemo(() => {
    const params: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      if (value) {
        params[key] = value;
      }
    });
    return params;
  }, [searchParams]);

  // ── filter 变化 → 更新 URL ──────────────────────────────────
  const handleParamsChange = useCallback(
    (formData: Record<string, unknown>) => {
      const qs = new URLSearchParams();
      Object.entries(formData).forEach(([key, value]) => {
        if (
          value !== undefined &&
          value !== null &&
          value !== '' &&
          value !== 'ALL'
        ) {
          qs.set(key, String(value));
        }
      });
      const newUrl = qs.toString()
        ? `/admin-users?${qs.toString()}`
        : '/admin-users';
      router.replace(newUrl, { scroll: false });
    },
    [router],
  );

  return (
    <AdminUserManagement
      initialFormParams={urlFilterParams}
      onParamsChange={handleParamsChange}
    />
  );
}
