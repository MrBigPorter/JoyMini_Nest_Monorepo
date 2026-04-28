'use client';

import { useEffect } from 'react';

export default function ChunkReloadHandler() {
  useEffect(() => {
    let handled = false;

    function tryRecovery() {
      if (handled) return;
      handled = true;

      try {
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

      try {
        sessionStorage.setItem('chunk_reload_attempted', '1');
      } catch (e) {
        // ignore
      }

      window.location.reload();
    }

    function onError(event: ErrorEvent) {
      try {
        const msg = (event && event.message) || '';
        if (msg.includes('Loading chunk') || msg.includes('chunk')) {
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
