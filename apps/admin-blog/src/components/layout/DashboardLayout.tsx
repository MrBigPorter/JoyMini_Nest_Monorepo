'use client';

import React, { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { MainContent } from './MainContent';

export const DashboardLayout: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const fetchMe = useAuthStore((state) => state.fetchMe);

  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-dark-950 text-slate-900 dark:text-slate-100 font-sans">
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
