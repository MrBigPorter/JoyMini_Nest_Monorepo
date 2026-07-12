---
name: frontend-design
description: Generate admin dashboard pages following JoyMini admin-next patterns — Server Component → Client Wrapper, SchemaSearchForm + BaseTable + ModalManager, React Query, i18n
user-invocable: true
---

# frontend-design — Admin Page Generator

You are a Next.js expert specializing in the JoyMini admin dashboard (`apps/admin-next/`). Generate production-ready admin pages following the Server Component → Client Wrapper pattern.

## Required Reading Before Generation

Read these template files to match patterns:
1. `apps/admin-next/src/app/(dashboard)/kyc/page.tsx` — Server Component + HydrationBoundary
2. `apps/admin-next/src/views/OrderManagement.tsx` — Full CRUD client page
3. `apps/admin-next/src/components/scaffold/SchemaSearchForm.tsx` — Search form
4. `apps/admin-next/src/components/scaffold/BaseTable.tsx` — Table pattern
5. `apps/admin-next/src/routes/index.ts` — Route registration
6. `apps/admin-next/src/api/index.ts` — API clients (check existing endpoints)

## Generation Steps

### Step 1: Server Component Page with SSR Prefetch
`apps/admin-next/src/app/(dashboard)/{feature}/page.tsx`
```tsx
import type { Metadata } from 'next';
import React, { Suspense } from 'react';
import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query';
import { {Feature}Client } from '@/components/{feature}/{Feature}Client';
import { serverGet } from '@/lib/serverFetch';
import { PageSkeleton } from '@/components/ui/PageSkeleton';

export const metadata: Metadata = { title: '{Feature Title}' };

export default async function {Feature}Page() {
  const queryClient = new QueryClient();

  // Prefetch data on server — hydrates into client React Query cache
  await queryClient.prefetchQuery({
    queryKey: ['{feature}'],
    queryFn: () => serverGet<PaginatedResponse<{Feature}Type>>('/admin/{feature}/list'),
  });

  return (
    <Suspense fallback={<PageSkeleton />}>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <{Feature}Client />
      </HydrationBoundary>
    </Suspense>
  );
}
```

### Step 2: Client Component
`apps/admin-next/src/components/{feature}/{Feature}Client.tsx`
```tsx
'use client';
import React, { useCallback } from 'react';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { SchemaSearchForm } from '@/components/scaffold/SchemaSearchForm';
import { BaseTable } from '@/components/scaffold/BaseTable';
import { ModalManager } from '@repo/ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/UIComponents';
import { useToastStore } from '@/store/useToastStore';
import { useTranslation } from '@/hooks/useTranslation';
import type { SearchFieldSchema } from '@/type/search';
// ... API imports

export const {Feature}Client: React.FC = () => {
  const addToast = useToastStore(s => s.addToast);
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Search schema
  const searchSchema: SearchFieldSchema<{...}>[] = [
    { key: 'keyword', label: t('common.keyword'), type: 'text' },
    { key: 'status', label: t('common.status'), type: 'select', options: [...] },
  ];

  // Data fetching with React Query
  const { data, isLoading } = useQuery({
    queryKey: ['{feature}', searchParams],
    queryFn: () => {feature}Api.getList(searchParams),
  });

  // Mutation for create/update/delete
  const createMutation = useMutation({
    mutationFn: {feature}Api.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['{feature}'] });
      addToast({ type: 'success', message: t('common.created') });
    },
  });

  // Modal interactions via ModalManager.open()
  const openCreateModal = useCallback(() => {
    ModalManager.open({
      title: t('{feature}.create'),
      renderChildren: ({ close }) => <div>{/* form */}</div>,
    });
  }, []);

  return ( /* PageHeader + SchemaSearchForm + BaseTable */ );
};
```

> **Note**: For simpler paginated tables, `useAntdTable` from `ahooks` is also used in older pages (see `OrderManagement.tsx`). Prefer `useQuery` + `useMutation` for new code.

### Step 3: API Client
Add to `apps/admin-next/src/api/{feature}.ts` following HttpClient pattern.

### Step 4: Route Registration
Add entry to `apps/admin-next/src/routes/index.ts`.

### Step 5: i18n Locale
Add translation keys to `apps/admin-next/src/i18n/locales/{lang}.json`.

### Step 6: Type Definition
Add types to `apps/admin-next/src/type/types.ts`.

## Conventions Recap
- New files in `src/components/{feature}/` for client components
- `@tanstack/react-table` ColumnDef for table columns
- `useQuery` + `useMutation` from React Query for data fetching (preferred for new code)
- `useAntdTable` from ahooks also used in older pages — check existing pattern before choosing
- `ModalManager.open()` for all modals
- `useToastStore` for notifications
- `useTranslation()` for all user-facing strings
- Tailwind v4, dark mode via `.dark` class
- API through typed HttpClient singleton
- TypeScript strict — no `any`

## Quality Checklist
- [ ] SSR data prefetch via `serverGet()`
- [ ] Loading skeleton in Suspense fallback
- [ ] Empty state handling in table
- [ ] Error toast on API failure
- [ ] i18n keys for all user-facing text
- [ ] Route registered in RouteConfig
- [ ] TypeScript strict
- [ ] Responsive + dark mode support
- [ ] React Query cache invalidation on mutation success
