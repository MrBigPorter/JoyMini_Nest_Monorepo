import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Login } from '@/views/Login';

export const metadata: Metadata = {
  title: 'Sign In',
  description: 'Sign in to JoyMini Blog Admin.',
  alternates: { canonical: '/login' },
  openGraph: {
    title: 'Sign In | JoyMini Blog Admin',
    description: 'Sign in to JoyMini Blog Admin.',
    url: '/login',
  },
};

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <Login />
    </Suspense>
  );
}
