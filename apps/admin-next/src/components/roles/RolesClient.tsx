'use client';

/**
 * RolesClient — thin Client Component wrapper for RolesManagement
 * No URL filter needed for this page (role cards are interactive client-side).
 */
import React from 'react';
import { RolesManagement } from './RolesManagementClient';

export function RolesClient() {
  return <RolesManagement />;
}
