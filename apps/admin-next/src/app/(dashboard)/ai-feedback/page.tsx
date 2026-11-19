import type { Metadata } from 'next';
import React from 'react';
import { AiFeedbackClient } from '@/components/ai-feedback/AiFeedbackClient';

export const metadata: Metadata = { title: 'AI Feedback' };

export default function AiFeedbackPage() {
  return <AiFeedbackClient />;
}
