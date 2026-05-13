/**
 * ModalManager — imperative modal API.
 *
 * Instead of creating a separate React root (which would lose all React
 * Context), this delegates to a module-level store.  A <ModalProvider>
 * component (rendered inside the app's React tree) picks up store entries
 * and renders them via createPortal — preserving context access.
 *
 * Usage is unchanged:
 *   ModalManager.open({ title, renderChildren: ... })
 */
import type { ModalProps } from "./Types.ts";
import { modalStore } from "./modal-store.ts";

export const ModalManager = {
  open: (
    props: Omit<ModalProps, "onFinishClose">,
  ): { close: () => void } => {
    return modalStore.open(props);
  },
};
