'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Dashboard Home Page — redirects to blog overview
 * Uses client-side redirect to avoid RSC redirect throwing NEXT_REDIRECT
 * during navigation transitions, which can destabilize React's hook chain.
 */
export default function DashboardPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/blog');
  }, [router]);

  return null;
}
