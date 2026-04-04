import React from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { routes } from '@/routes';
import { TRANSLATIONS } from '@/constants';

/**
 * generateMetadata — 集中管理所有 dashboard 子页面的 <title>
 * 通过 middleware 写入的 x-pathname header 获取当前路径，
 * 查 routes + TRANSLATIONS 得到对应英文标题，无需在每个 page 单独写 metadata。
 */
export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const pathname = (h.get('x-pathname') || '/').replace(/\/$/, '') || '/';
  const route = routes.find((r) => r.path === pathname);
  const title = route
    ? (TRANSLATIONS.en[route.name as keyof typeof TRANSLATIONS.en] ??
      route.name)
    : undefined;
  return { title };
}

// ...existing code...
export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token')?.value;

  if (!token) {
    redirect('/login');
  }

  return <DashboardLayout>{children}</DashboardLayout>;
}
