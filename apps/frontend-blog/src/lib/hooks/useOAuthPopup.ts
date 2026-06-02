'use client';

import { useCallback, useRef } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────

export type OAuthProvider = 'google' | 'facebook';

export interface OAuthTokenResult {
  token: string;
  refreshToken: string;
  provider: OAuthProvider | 'generic';
}

interface UseOAuthPopupOptions {
  /** Whether to include `inviteCode` param from URL searchParams */
  inviteCode?: string | null;
  /** The `client` parameter (e.g. 'web' or 'app') */
  client?: string | null;
  /** App deep link callback URL */
  appCallback?: string | null;
  /** App platform ('ios' or 'android') */
  appPlatform?: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────

const OAUTH_STORAGE_KEY = 'oauth_token_result';

/** Interval (ms) for polling localStorage in case Chrome throttles StorageEvent */
const POLL_INTERVAL_MS = 200;

/** Interval (ms) for checking if the popup has been closed */
const POPUP_CLOSE_CHECK_MS = 500;

/**
 * Grace period (ms) after popup close before considering the flow cancelled.
 * This prevents a race condition where the popup closes a few ms before the
 * token arrives.
 *
 * Set to 15 s to survive Chrome's aggressive background-tab timer throttling:
 * when the popup is in focus the parent tab may be frozen, so the 200 ms poll
 * timer won't fire until after the tab is unfrozen.  The `focus` event handler
 * below is the primary fast-path; this is the safety-net.
 */
const GRACE_PERIOD_MS = 15000;

/**
 * Overall timeout (ms) for the entire OAuth flow.
 * If no token is received within this time, the promise rejects.
 */
const OVERALL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Synchronously open a popup window using `about:blank` to bypass popup blockers,
 * then navigate it to the target URL.
 */
function openPopup(url: string): Window | null {
  // Step 1: synchronously open about:blank
  const popup = window.open('about:blank', '_blank', 'width=600,height=700');
  if (!popup) {
    // Popup blocker prevented the window from opening
    return null;
  }

  try {
    // Step 2: inject a minimal loading indicator while we navigate
    popup.document.write(
      '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Loading...</title>' +
        '<style>body{margin:0;display:flex;align-items:center;justify-content:center;' +
        'min-height:100vh;background:#f9fafb;font-family:sans-serif;color:#6b7280;}' +
        '.spinner{width:36px;height:36px;border:3px solid #e5e7eb;' +
        'border-top-color:#3b82f6;border-radius:50%;animation:spin .8s linear infinite;' +
        'margin:0 auto 1rem}@keyframes spin{to{transform:rotate(360deg)}}</style></head>' +
        '<body><div><div class="spinner"></div><p>Redirecting to provider...</p></div></body></html>',
    );
    popup.document.close();
  } catch {
    // Some browsers may not allow document.write on cross-origin about:blank
    // This is fine, we just skip the loading indicator
  }

  // Step 3: navigate to the actual OAuth URL using a short timeout to ensure
  // the popup is fully initialized
  setTimeout(() => {
    try {
      popup.location.href = url;
    } catch {
      // popup may have been closed already
    }
  }, 50);

  return popup;
}

/**
 * Generate a CSRF state parameter (mirrors the logic in `generateWebState` in
 * the login page).
 */
function generateState(client: string): string {
  const state = {
    provider: 'google', // placeholder, updated when constructing the URL
    nonce: Math.random().toString(36).substring(7),
    timestamp: Date.now(),
    client,
  };
  const base64 = btoa(JSON.stringify(state));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ─── Hook ────────────────────────────────────────────────────────────────

/**
 * `useOAuthPopup` – Opens an OAuth login flow in a popup window and returns
 * the authentication tokens via a Promise.
 *
 * ## Communication channels (redundant – any one is sufficient):
 * 1. **postMessage** (primary) – fastest, works when `window.opener` is available
 * 2. **StorageEvent** (COOP fallback) – works when cross-origin isolation breaks `opener`
 * 3. **localStorage polling 200ms** (Chrome background tab workaround) – bypasses
 *    Chrome's aggressive StorageEvent throttling for background tabs
 * 4. **window `focus` event** (frozen-tab fast-path) – fires immediately when the
 *    popup closes and focus returns to the parent, even if Chrome has frozen all
 *    timers; reads localStorage directly on the event
 *
 * ## Race condition handling:
 * The popup close detection includes a 15-second grace period before rejecting
 * as "cancelled". This prevents the case where the popup closes a few ms before
 * the token message arrives, and gives throttled/frozen timers time to recover.
 */
export function useOAuthPopup(options: UseOAuthPopupOptions = {}) {
  const { inviteCode, client, appCallback, appPlatform } = options;

  // Keep abort controller ref for cleanup
  const abortRef = useRef<AbortController | null>(null);

  const openOAuthPopup = useCallback(
    (provider: OAuthProvider): Promise<OAuthTokenResult> => {
      // ── Clear stale OAuth token from previous session ────────────
      // Prevents the localStorage polling channel from immediately
      // resolving with a leftover token from a prior login after logout.
      localStorage.removeItem('oauth_token_result');

      return new Promise<OAuthTokenResult>((resolve, reject) => {
        // ── Abort previous flow if any ──────────────────────────────
        abortRef.current?.abort();
        const abortController = new AbortController();
        abortRef.current = abortController;
        const signal = abortController.signal;

        // ── Build OAuth URL ────────────────────────────────────────
        const oauthOrigin = process.env.NEXT_PUBLIC_OAUTH_API_ORIGIN || '';
        const isFromApp = client === 'app' && appCallback;

        const params = new URLSearchParams();

        if (!isFromApp) {
          // Web flow: redirect to the static popup callback HTML
          params.set(
            'redirect_uri',
            `${window.location.origin}/oauth-popup-callback.html`,
          );
          params.set('state', generateState(client || 'web'));
        } else {
          // App flow: use deep link callback
          if (appCallback) params.set('callback', appCallback);
          if (appPlatform) params.set('platform', appPlatform);
        }

        params.set('client', client || 'web');
        if (inviteCode) params.set('inviteCode', inviteCode);

        const url = `${oauthOrigin}/auth/${provider}/login?${params.toString()}`;

        // ── Open popup ──────────────────────────────────────────────
        const popup = openPopup(url);
        if (!popup) {
          reject(new Error('popup_blocked'));
          return;
        }

        // ── State ───────────────────────────────────────────────────
        let isResolved = false;
        let isCancelled = false;
        let graceTimer: ReturnType<typeof setTimeout> | null = null;
        let pollTimer: ReturnType<typeof setInterval> | null = null;
        let closeCheckTimer: ReturnType<typeof setInterval> | null = null;
        let overallTimeout: ReturnType<typeof setTimeout> | null = null;

        // ── Cleanup helper ──────────────────────────────────────────
        function cleanup() {
          if (pollTimer) clearInterval(pollTimer);
          if (closeCheckTimer) clearInterval(closeCheckTimer);
          if (graceTimer) clearTimeout(graceTimer);
          if (overallTimeout) clearTimeout(overallTimeout);
          window.removeEventListener('message', handleMessage);
          window.removeEventListener('storage', handleStorage);
          window.removeEventListener('focus', handleFocus);
          abortController.abort();
        }

        // ── Resolve helper ──────────────────────────────────────────
        function resolveWith(result: OAuthTokenResult) {
          if (isResolved || signal.aborted) return;
          isResolved = true;
          cleanup();
          resolve(result);
        }

        // ── Reject helper ───────────────────────────────────────────
        function rejectWith(error: Error) {
          if (isResolved || signal.aborted) return;
          isResolved = true;
          cleanup();
          reject(error);
        }

        // ═══════════════════════════════════════════════════════════
        // Channel 1: postMessage (primary)
        // ═══════════════════════════════════════════════════════════
        function handleMessage(event: MessageEvent) {
          if (signal.aborted) return;
          try {
            const data = event.data;
            if (
              data &&
              typeof data === 'object' &&
              data.type === 'OAUTH_TOKEN' &&
              data.payload &&
              data.payload.token
            ) {
              resolveWith(data.payload as OAuthTokenResult);
            }
          } catch {
            // ignore malformed messages
          }
        }
        window.addEventListener('message', handleMessage);

        // ═══════════════════════════════════════════════════════════
        // Channel 2: StorageEvent (COOP fallback)
        // ═══════════════════════════════════════════════════════════
        function handleStorage(event: StorageEvent) {
          if (signal.aborted) return;
          if (event.key === OAUTH_STORAGE_KEY && event.newValue) {
            try {
              const data = JSON.parse(event.newValue) as OAuthTokenResult;
              if (data.token) {
                resolveWith(data);
              }
            } catch {
              // ignore parse errors
            }
          }
        }
        window.addEventListener('storage', handleStorage);

        // ═══════════════════════════════════════════════════════════
        // Channel 4: window focus (primary fast-path for Chrome frozen tabs)
        // ═══════════════════════════════════════════════════════════
        // When the OAuth popup closes the parent tab immediately regains
        // focus.  The `focus` event fires even when Chrome has frozen all
        // timers in the background tab, so this is the most reliable way
        // to pick up the token without waiting for a throttled interval.
        function handleFocus() {
          if (signal.aborted) return;
          try {
            const stored = localStorage.getItem(OAUTH_STORAGE_KEY);
            if (stored) {
              const data = JSON.parse(stored) as OAuthTokenResult;
              if (data.token) {
                console.log(
                  '[OAuthPopup] focus: token found in localStorage, resolving',
                );
                resolveWith(data);
              }
            }
          } catch {
            // ignore
          }
        }
        window.addEventListener('focus', handleFocus);

        // ═══════════════════════════════════════════════════════════
        // Channel 3: localStorage polling every 200ms
        // (Bypasses Chrome background tab StorageEvent throttling)
        // ═══════════════════════════════════════════════════════════
        pollTimer = setInterval(() => {
          if (signal.aborted) return;
          try {
            const stored = localStorage.getItem(OAUTH_STORAGE_KEY);
            if (stored) {
              const data = JSON.parse(stored) as OAuthTokenResult;
              if (data.token) {
                resolveWith(data);
              }
            }
          } catch {
            // ignore
          }
        }, POLL_INTERVAL_MS);

        // ═══════════════════════════════════════════════════════════
        // Popup close detection + Grace period for race condition
        // ═══════════════════════════════════════════════════════════
        closeCheckTimer = setInterval(() => {
          if (signal.aborted) return;

          // If popup was already closed and we're in grace period, skip
          if (isCancelled) return;

          try {
            if (popup.closed) {
              isCancelled = true;

              // Don't reject immediately — wait for GRACE_PERIOD_MS in
              // case the token arrives just after the popup closes.
              graceTimer = setTimeout(() => {
                // ── Final localStorage check before giving up ──────
                // Guards against the case where Chrome froze the poll
                // timer AND the focus event was somehow missed.
                try {
                  const stored = localStorage.getItem(OAUTH_STORAGE_KEY);
                  if (stored) {
                    const data = JSON.parse(stored) as OAuthTokenResult;
                    if (data.token) {
                      console.log(
                        '[OAuthPopup] grace: token found at last check, resolving',
                      );
                      resolveWith(data);
                      return;
                    }
                  }
                } catch {
                  // ignore
                }
                rejectWith(new Error('cancelled'));
              }, GRACE_PERIOD_MS);
            }
          } catch {
            // Some browsers throw when accessing popup.closed cross-origin
            // Treat as if it's still open
          }
        }, POPUP_CLOSE_CHECK_MS);

        // ═══════════════════════════════════════════════════════════
        // Overall timeout (5 min)
        // ═══════════════════════════════════════════════════════════
        overallTimeout = setTimeout(() => {
          rejectWith(new Error('timeout'));
        }, OVERALL_TIMEOUT_MS);

        // ═══════════════════════════════════════════════════════════
        // Cleanup on abort (e.g. component unmount)
        // ═══════════════════════════════════════════════════════════
        signal.addEventListener(
          'abort',
          () => {
            if (!isResolved) {
              isResolved = true;
              cleanup();
              reject(new Error('aborted'));
            }
          },
          { once: true },
        );
      });
    },
    [inviteCode, client, appCallback, appPlatform],
  );

  /**
   * Manually abort the current OAuth flow (e.g. if the user closes the login modal).
   */
  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { openOAuthPopup, abort };
}
