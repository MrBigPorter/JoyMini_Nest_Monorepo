'use client';

import React from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import type { LocalizedString } from '@lucky/shared';

interface LocalizedTextProps {
  value: LocalizedString | string | null | undefined;
  fallback?: string;
}

export const LocalizedText: React.FC<LocalizedTextProps> = ({
  value,
  fallback = '',
}) => {
  const { locale } = useLanguage();

  if (!value) return fallback;
  if (typeof value === 'string') return value;

  return value[locale] ?? value.zh ?? value.en ?? fallback;
};

export default LocalizedText;
