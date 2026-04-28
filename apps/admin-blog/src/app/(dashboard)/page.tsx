import { redirect } from 'next/navigation';

/**
 * Dashboard Home Page — redirects to blog overview
 */
export default function DashboardPage() {
  redirect('/blog');
}
