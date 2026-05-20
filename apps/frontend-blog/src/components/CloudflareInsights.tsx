'use client';

import Script from 'next/script';

/**
 * Cloudflare Web Analytics — deferred loading
 *
 * Injected via Next.js <Script strategy="lazyOnload"> so it does NOT block
 * initial page rendering. The script loads after the page becomes fully
 * interactive, avoiding contention for CPU and network bandwidth during
 * the critical rendering path (LCP / TBT).
 *
 * Previously this was a plain <script defer> in layout.tsx which still
 * competed for bandwidth in the early page load window. Moving it here
 * with strategy="lazyOnload" defers it until after onload.
 */
export function CloudflareInsights() {
  return (
    <Script
      src="https://static.cloudflareinsights.com/beacon.min.js"
      data-cf-beacon='{"token": "1ad32917390d4dda86d53395209e19a5"}'
      strategy="lazyOnload"
    />
  );
}
