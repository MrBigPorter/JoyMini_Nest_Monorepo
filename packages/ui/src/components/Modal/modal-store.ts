/**
 * Module-level store for modal instances.
 *
 * Replaces ReactDOM.createRoot with a publish-subscribe pattern so that
 * <ModalProvider> (rendered inside the app's React tree) can render modals
 * via createPortal — giving them access to all React Contexts (next-intl,
 * React Query, theme, etc.).
 *
 * Zero external dependencies: uses only plain JS closures + useSyncExternalStore.
 */
import type { ModalProps } from "./Types.ts";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ModalInstance {
  id: string;
  props: Omit<ModalProps, "onFinishClose">;
}

type Listener = () => void;

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

let instances: ModalInstance[] = [];
let nextId = 0;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((l) => l());
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getState(): readonly ModalInstance[] {
  return instances;
}

/**
 * Open a modal.  Returns `{ close }` — same contract as the old
 * ReactDOM.createRoot-based implementation.
 */
function open(
  props: Omit<ModalProps, "onFinishClose">,
): { close: () => void } {
  const id = `modal-${++nextId}`;
  instances = [...instances, { id, props }];
  notify();

  return {
    close: () => {
      instances = instances.filter((m) => m.id !== id);
      notify();
    },
  };
}

function close(id: string): void {
  instances = instances.filter((m) => m.id !== id);
  notify();
}

/* ------------------------------------------------------------------ */
/*  Export                                                             */
/* ------------------------------------------------------------------ */

export const modalStore = { subscribe, getState, open, close };
