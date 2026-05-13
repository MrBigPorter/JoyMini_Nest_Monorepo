'use client';

import React, { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { modalStore } from './modal-store';
import { ModalFixed } from './ModalFixed';

/**
 * Renders all active modals via createPortal into document.body.
 *
 * Must be rendered INSIDE <NextIntlClientProvider> (or equivalent context
 * providers) so that every modal has access to the same React Contexts as
 * the rest of the app.
 *
 * SSR safety: returns null when document is undefined (SSR/SSG).
 */
export function ModalProvider(): React.ReactNode {
  const instances = useSyncExternalStore(
    modalStore.subscribe,
    modalStore.getState,
    modalStore.getState,
  );

  // SSR guard — document is undefined during server rendering
  if (typeof document === 'undefined') return null;

  if (instances.length === 0) return null;

  return createPortal(
    <>
      {instances.map((m) => (
        <ModalFixed
          key={m.id}
          {...m.props}
          onFinishClose={() => {
            modalStore.close(m.id);
          }}
        />
      ))}
    </>,
    document.body,
  );
}
