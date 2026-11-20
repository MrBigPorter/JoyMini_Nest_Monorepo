import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'AI Feedback' };

export default function AiFeedbackPage() {
  redirect('/ai-ops/quality');
}
