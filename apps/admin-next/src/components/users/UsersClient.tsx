'use client';

import React, { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { UserListClient } from './UserListClient';

export function UsersClient() {
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

  const handleParamsChange = useCallback(
    (params: Record<string, unknown>) => {
      const qs = new URLSearchParams();

      Object.entries(params).forEach(([key, value]) => {
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

      const newUrl = qs.toString() ? `/users?${qs.toString()}` : '/users';
      router.replace(newUrl, { scroll: false });
    },
    [router],
  );

  return (
    <UserListClient
      initialFormParams={urlQueryParams}
      onParamsChange={handleParamsChange}
    />
  );
}
