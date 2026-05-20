'use client';

import { useState, useEffect } from 'react';

/**
 * Network quality type, matching the Network Information API's `effectiveType`.
 */
export type EffectiveType = 'slow-2g' | '2g' | '3g' | '4g' | 'unknown';

/**
 * Adaptive quality settings derived from network conditions.
 */
export interface NetworkQuality {
  /** Raw effective connection type */
  effectiveType: EffectiveType;
  /** Image quality percentage (1-100) to pass to Next.js `<Image>` quality prop */
  quality: number;
  /** Preferred image format based on network conditions */
  format: 'avif' | 'webp' | 'jpeg';
  /** If true, render only blurhash placeholder — skip full image download */
  shouldBlurOnly: boolean;
  /** Whether the user has enabled Save-Data mode */
  saveData: boolean;
  /** Estimated downlink speed in Mbps */
  downlink: number;
  /** Round-trip time in milliseconds */
  rtt: number;
}

/**
 * Map effectiveType → adaptive quality parameters.
 *
 * | effectiveType | quality | format   | blurOnly | Notes               |
 * |---------------|---------|----------|----------|---------------------|
 * | 4g / unknown  | 75      | avif     | false    | High quality AVIF   |
 * | 3g            | 45      | webp     | false    | Medium quality WebP |
 * | 2g            | 20      | webp     | false    | Low quality WebP    |
 * | slow-2g       | 10      | webp     | false    | Minimal bandwidth   |
 * | save-data:on  | 10      | webp     | false    | Data saver mode     |
 * | extreme       | —       | —        | true     | Blurhash only       |
 */

function getQualityFromType(
  type: EffectiveType,
  saveData: boolean,
): NetworkQuality {
  // Save-Data takes precedence — data saver users explicitly want minimal data
  if (saveData) {
    return {
      effectiveType: type,
      quality: 10,
      format: 'webp',
      shouldBlurOnly: false,
      saveData: true,
      downlink: 0,
      rtt: 0,
    };
  }

  switch (type) {
    case 'slow-2g':
      return {
        effectiveType: type,
        quality: 10,
        format: 'webp',
        shouldBlurOnly: false,
        saveData: false,
        downlink: 0,
        rtt: 0,
      };
    case '2g':
      return {
        effectiveType: type,
        quality: 20,
        format: 'webp',
        shouldBlurOnly: false,
        saveData: false,
        downlink: 0,
        rtt: 0,
      };
    case '3g':
      return {
        effectiveType: type,
        quality: 45,
        format: 'webp',
        shouldBlurOnly: false,
        saveData: false,
        downlink: 0,
        rtt: 0,
      };
    case '4g':
    case 'unknown':
    default:
      return {
        effectiveType: type,
        quality: 75,
        format: 'avif',
        shouldBlurOnly: false,
        saveData: false,
        downlink: 0,
        rtt: 0,
      };
  }
}

/**
 * Hook that monitors `navigator.connection` (Network Information API)
 * and returns adaptive quality settings.
 *
 * Falls back to `'unknown'` when the API is not available (e.g., iOS Safari,
 * older browsers) — uses default high quality.
 *
 * Usage:
 * ```tsx
 * const { quality, format, shouldBlurOnly } = useNetworkQuality();
 * ```
 */
export function useNetworkQuality(): NetworkQuality {
  // ⚠️ SSR/hydration safety: ALWAYS start with 'unknown' (quality: 75).
  //
  // If we read navigator.connection here in the initializer, the server renders
  // with quality:75 (no navigator) but the client may hydrate with quality:45
  // (e.g. navigator.connection.effectiveType === '3g' on slow/Cloudflare links).
  // Different quality → different srcSet URLs → React hydration mismatch.
  //
  // By using a static initial value we guarantee server === client during
  // hydration. The actual network quality is applied in useEffect (post-hydration)
  // so React re-renders with the correct srcSet without any mismatch error.
  const [quality, setQuality] = useState<NetworkQuality>(() =>
    getQualityFromType('unknown', false),
  );

  useEffect(() => {
    // Read real network quality after hydration completes (client-only)
    const conn = (navigator as any).connection;
    if (conn) {
      const saveData =
        typeof conn.saveData === 'boolean' ? conn.saveData : false;
      setQuality(getQualityFromType(conn.effectiveType || 'unknown', saveData));
    }

    if (!conn) return;

    const handleChange = () => {
      const saveData =
        typeof conn.saveData === 'boolean' ? conn.saveData : false;
      setQuality(getQualityFromType(conn.effectiveType || 'unknown', saveData));
    };

    // Listen for network changes (effectiveType, downlink, rtt, saveData)
    conn.addEventListener('change', handleChange);
    return () => conn.removeEventListener('change', handleChange);
  }, []);

  return quality;
}
