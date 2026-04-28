import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
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
  const cookieStore = await cookies();
  const authToken = cookieStore.get('auth_token')?.value;

  if (!authToken) {
    redirect('/login');
  }

  return <DashboardLayout>{children}</DashboardLayout>;
}
