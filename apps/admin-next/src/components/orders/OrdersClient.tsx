'use client';

/**
 * OrdersClient — Client Component
 * Phase 6: URL searchParams 驱动 filter（列表消费下沉到 OrderListClient）
 */
import React, { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { OrderListClient } from './OrderListClient';

export function OrdersClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlQueryParams = useMemo(() => {
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
          value !== 'ALL' &&
          value !== 'All'
        ) {
          qs.set(key, String(value));
        }
      });
      const newUrl = qs.toString() ? `/orders?${qs.toString()}` : '/orders';
      router.replace(newUrl, { scroll: false });
    },
    [router],
  );

  return (
    <OrderListClient
      initialFormParams={urlQueryParams}
      onParamsChange={handleParamsChange}
    />
  );
}
