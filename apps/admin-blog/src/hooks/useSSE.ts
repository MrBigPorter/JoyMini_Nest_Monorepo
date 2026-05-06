'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────

export interface SseProgressEvent {
  type: 'progress';
  processed: number;
  total: number;
  incompleteSoFar: number;
}

export interface SseCompleteEvent {
  type: 'complete';
  total: number;
  incompleteCount: number;
  completionRate: string;
  incompleteArticles: any[];
}

export type SseEvent = SseProgressEvent | SseCompleteEvent;

export interface UseSseOptions {
  /** Auto-connect on mount (default: false) */
  autoConnect?: boolean;
  /** Callback on each SSE event */
  onEvent?: (event: SseEvent) => void;
  /** Callback on connection error */
  onError?: (error: Error) => void;
}

export interface UseSseReturn {
  /** Connect to the SSE endpoint */
  connect: () => void;
  /** Disconnect from the SSE endpoint (abort) */
  disconnect: () => void;
  /** Whether the connection is active */
  isConnecting: boolean;
  /** Error object if connection failed */
  error: Error | null;
  /** Latest progress event */
  progress: SseProgressEvent | null;
  /** Final result event */
  result: SseCompleteEvent | null;
  /** Connection progress percentage (0-100) */
  progressPercent: number;
}

/**
 * Custom hook for connecting to a Server-Sent Events (SSE) endpoint.
 * Uses the native EventSource API.
 *
 * NOTE: EventSource sends cookies automatically (for cookie-based auth).
 * If the endpoint requires Authorization header, construct the URL with a
 * query token instead.
 */
export function useSse(url: string, options: UseSseOptions = {}): UseSseReturn {
  const { autoConnect = false, onEvent, onError } = options;

  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [progress, setProgress] = useState<SseProgressEvent | null>(null);
  const [result, setResult] = useState<SseCompleteEvent | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);

  // Compute progress percentage
  const progressPercent =
    progress && progress.total > 0
      ? Math.round((progress.processed / progress.total) * 100)
      : result
        ? 100
        : 0;

  const connect = useCallback(() => {
    // Cleanup previous connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setError(null);
    setProgress(null);
    setResult(null);
    setIsConnecting(true);

    const es = new EventSource(url, { withCredentials: true });

    es.onmessage = (event: MessageEvent) => {
      try {
        // NestJS @Sse() double-wraps data: { data: { type: 'progress', ... } }
        // Unwrap to get the actual payload
        const parsed = JSON.parse(event.data);
        const data: SseEvent = (parsed as any).data ?? parsed;
        if (data.type === 'progress') {
          setProgress(data);
          onEvent?.(data);
        } else if (data.type === 'complete') {
          setResult(data);
          setProgress(null);
          setIsConnecting(false);
          onEvent?.(data);
          es.close();
        }
      } catch {
        // Ignore non-JSON messages (e.g. keep-alive comments)
      }
    };

    es.onerror = () => {
      // EventSource fires onerror when connection fails or is closed
      if (es.readyState === EventSource.CLOSED) {
        setIsConnecting(false);
        const err = new Error('SSE connection closed unexpectedly');
        setError(err);
        onError?.(err);
      }
    };

    es.onopen = () => {
      setIsConnecting(true);
    };

    eventSourceRef.current = es;
  }, [url, onEvent, onError]);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsConnecting(false);
  }, []);

  // Auto-connect if autoConnect is true
  useEffect(() => {
    if (autoConnect) {
      connect();
    }
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [autoConnect, connect]);

  return {
    connect,
    disconnect,
    isConnecting,
    error,
    progress,
    result,
    progressPercent,
  };
}
