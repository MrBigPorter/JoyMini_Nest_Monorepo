'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { MainContent } from './MainContent';
import { Loader2 } from 'lucide-react';

export const DashboardLayout: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const fetchMe = useAuthStore((state) => state.fetchMe);

  // ── Frontend auth guard ──────────────────────────────────────────────
  // Since middleware no longer checks auth_token cookie on the new domain,
  // we guard protected routes on the client side using localStorage.
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    setIsAuthReady(true);
  }, [router]);

  useEffect(() => {
    if (isAuthReady) {
      void fetchMe();
    }
  }, [isAuthReady, fetchMe]);

  // Full-screen loading spinner while checking auth — prevents flash of
  // dashboard content before redirect to /login.
  if (!isAuthReady) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-dark-950">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-dark-950 text-slate-900 dark:text-slate-100 font-sans">
      <Sidebar
        mobileOpen={mobileMenuOpen}
        onMobileCloseAction={() => setMobileMenuOpen(false)}
      />
      <div className="flex-1 flex flex-col w-full transition-all duration-300 ease-in-out">
        <Header onMenuButtonClickAction={() => setMobileMenuOpen(true)} />
        <MainContent>{children}</MainContent>
      </div>
    </div>
  );
};
