'use client';

import { useEffect } from 'react';

/**
 * Recovery helper for runtime ChunkLoadError / Loading chunk failed.
 * - Detects ChunkLoadError and un-registers service workers / clears caches,
 *   then reloads the page once to recover (useful after a new deploy where
 *   browser still holds old _next chunk manifests).
 */
export default function ChunkReloadHandler() {
  useEffect(() => {
    let handled = false;

    function tryRecovery() {
      if (handled) return;
      handled = true;

      try {
        // Unregister service workers (if any)
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker
            .getRegistrations()
            .then((regs) =>
              regs.forEach((r) => r.unregister().catch(() => {})),
            );
        }
      } catch (e) {
        // ignore
      }

      try {
        // Clear caches (best-effort)
        if (typeof caches !== 'undefined') {
          caches
            .keys()
            .then((keys) =>
              Promise.all(keys.map((k) => caches.delete(k))).catch(() => {}),
            );
        }
      } catch (e) {
        // ignore
      }

      // Avoid reload loops: set a session flag
      try {
        sessionStorage.setItem('chunk_reload_attempted', '1');
      } catch (e) {
        // ignore
      }

      // Reload the page to attempt fetching new _next chunks
      window.location.reload();
    }

    function onError(event: ErrorEvent) {
      try {
        const msg = (event && event.message) || '';
        if (msg.includes('Loading chunk') || msg.includes('chunk')) {
          // attempt recovery
          // do not preventDefault so error still shows if recovery fails
          if (!sessionStorage.getItem('chunk_reload_attempted')) {
            tryRecovery();
          }
        }
      } catch (e) {
        // ignore
      }
    }

    function onUnhandledRejection(ev: PromiseRejectionEvent) {
      try {
        const reason = ev?.reason || {};
        const msg = (reason && (reason.message || String(reason))) || '';
        if (msg.includes('Loading chunk') || msg.includes('ChunkLoadError')) {
          if (!sessionStorage.getItem('chunk_reload_attempted')) {
            tryRecovery();
          }
        }
      } catch (e) {
        // ignore
      }
    }

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  return null;
}
