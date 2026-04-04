'use client';

/**
 * OperationLogClient — Client Component
 * Phase 3: URL searchParams 驱动 filter
 */
import React, { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { OperationLogList } from './OperationLogListClient';

export function OperationLogClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── URL → 初始 filter 参数 ──────────────────────────────────
  const urlFilterParams = useMemo(() => {
    const params: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      if (key !== 'dateRange' && value) {
        params[key] = value;
      }
    });
    return params;
  }, [searchParams]);

  // ── filter 变化 → 更新 URL ──────────────────────────────────
  const handleParamsChange = useCallback(
    (formData: Record<string, unknown>) => {
      const qs = new URLSearchParams();

      const dateRange = formData.dateRange as
        | { from?: string; to?: string }
        | undefined;
      const startDate =
        typeof formData.startDate === 'string'
          ? formData.startDate
          : dateRange?.from;
      const endDate =
        typeof formData.endDate === 'string' ? formData.endDate : dateRange?.to;

      Object.entries(formData).forEach(([key, value]) => {
        if (key === 'dateRange' || key === 'startDate' || key === 'endDate') {
          return;
        }
        if (
          value !== undefined &&
          value !== null &&
          value !== '' &&
          value !== 'ALL'
        ) {
          qs.set(key, String(value));
        }
      });

      if (startDate) {
        qs.set('startDate', startDate);
      }
      if (endDate) {
        qs.set('endDate', endDate);
      }

      const newUrl = qs.toString()
        ? `/operation-logs?${qs.toString()}`
        : '/operation-logs';
      router.replace(newUrl, { scroll: false });
    },
    [router],
  );

  return (
    <OperationLogList
      initialFormParams={urlFilterParams}
      onParamsChange={handleParamsChange}
    />
  );
}

export const OperationLogsClient = OperationLogClient;
