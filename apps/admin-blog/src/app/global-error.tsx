'use client';

// Import from @sentry/browser (browser-only SDK) instead of @sentry/nextjs.
// global-error.tsx is traced into the server bundle by Next.js even with 'use client',
// so importing @sentry/nextjs here pulled webpack + OpenTelemetry + @sentry/node (~5 MiB)
// into the Cloudflare Worker. @sentry/browser has none of those.
import { captureException } from '@sentry/browser';
import NextError from 'next/error';
import { useEffect } from 'react';

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        {/* `NextError` is the default Next.js error page component. Its type
        definition requires a `statusCode` prop. However, since the App Router
        does not expose status codes for errors, we simply pass 0 to render a
        generic error message. */}
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
