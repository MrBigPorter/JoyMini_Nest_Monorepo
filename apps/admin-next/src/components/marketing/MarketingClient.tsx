'use client';

/**
 * MarketingClient — Client Component wrapper
 * Marketing view manages its own state internally (no URL filter needed)
 */
import React from 'react';
import { Marketing } from './MarketingPageClient';

export function MarketingClient() {
  return <Marketing />;
}
