/**
 * 🌐 Site-wide constants for the frontend blog
 *
 * Centralized site configuration. To change the canonical domain,
 * update `SITE_URL` here — all source files import from this constant.
 */

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || 'https://blog.tarsierlabs.app';
