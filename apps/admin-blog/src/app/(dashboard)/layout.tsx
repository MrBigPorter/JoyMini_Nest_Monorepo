import type { Metadata } from 'next';
import { DashboardLayout } from '@/components/layout/DashboardLayout';

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Blog Admin',
  };
}

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardLayout>{children}</DashboardLayout>;
}
