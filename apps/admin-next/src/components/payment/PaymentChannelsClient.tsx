'use client';

/**
 * PaymentChannelsClient — Client Component
 * Phase 3: URL searchParams 驱动 filter
 */
import React, { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PaymentChannelList } from './PaymentChannelListClient';

export function PaymentChannelsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── URL → 初始 filter 参数 ──────────────────────────────────
  const urlFilterParams = useMemo(() => {
    const params: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      if (key !== 'page' && key !== 'pageSize' && value) {
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
        ? `/payment-channels?${qs.toString()}`
        : '/payment-channels';
      router.replace(newUrl, { scroll: false });
    },
    [router],
  );

  return (
    <PaymentChannelList
      initialFormParams={urlFilterParams}
      onParamsChange={handleParamsChange}
    />
  );
}
