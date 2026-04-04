'use client';

/**
 * FinanceClient — Client Component
 * Phase 3: URL searchParams 驱动 filter
 */
import React, { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FinancePage } from './FinancePageClient';
import { ErrorBoundary } from './ErrorBoundary';

export function FinanceClient() {
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

      // Keep current URL params first, then apply incoming changes.
      // This avoids dropping filters when a child emits partial updates
      // (e.g. FinancePage syncing only { tab } on mount/tab switch).
      searchParams.forEach((value, key) => {
        qs.set(key, value);
      });

      Object.entries(formData).forEach(([key, value]) => {
        if (
          value !== undefined &&
          value !== null &&
          value !== '' &&
          value !== 'ALL'
        ) {
          qs.set(key, String(value));
        } else if (value === '' || value === 'ALL') {
          // 如果字段被清空了，则从 qs 中移除
          qs.delete(key);
        }
      });
      const newUrl = qs.toString() ? `/finance?${qs.toString()}` : '/finance';
      router.replace(newUrl, { scroll: false });
    },
    [router, searchParams],
  );

  return (
    <ErrorBoundary>
      <FinancePage
        initialFormParams={urlFilterParams}
        onParamsChange={handleParamsChange}
      />
    </ErrorBoundary>
  );
}
