import type { Metadata } from 'next';
import '../globals.css';

export const metadata: Metadata = {
  title: 'OAuth Callback - Tarsier Labs',
  description: 'OAuth authentication callback',
};

export default function OAuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">{children}</div>
  );
}
