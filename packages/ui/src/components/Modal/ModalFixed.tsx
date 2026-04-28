import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../button.tsx";
import { ModalProps } from "./Types.ts";

/**
 * Wrapper component that calls the renderChildren function as a proper React
 * component. This isolates any hooks inside the function from ModalFixed's
 * own hook tree, preventing "Rendered fewer hooks than expected" errors when
 * the modal closes (visible becomes false) and the function is no longer called.
 */
function RenderChildrenWrapper({
  fn,
  close,
  confirm,
}: {
  fn: (helpers: { close: () => void; confirm: () => void }) => React.ReactNode;
  close: () => void;
  confirm: () => void;
}) {
  return <>{fn({ close, confirm })}</>;
}

export function ModalFixed({
  title,
  content,
  confirmText,
  cancelText,
  onCancel,
  onConfirm,
  renderChildren,
  onFinishClose,
  showClose = true,
  className,
  enableClickOutsideClose = false,
  size = "lg",
}: Readonly<ModalProps>): React.JSX.Element {
  const [visible, setVisible] = React.useState<boolean>(true);

  const handleClose = React.useCallback(() => setVisible(false), []);

  const confirm = React.useCallback(() => {
    onConfirm?.();
    handleClose();
  }, [onConfirm, handleClose]);

  const cancel = React.useCallback(() => {
    onCancel?.();
    handleClose();
  }, [onCancel, handleClose]);

  const sizes = {
    sm: "max-w-sm",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
    xxl: "max-w-6xl",
  };

  return (
    <AnimatePresence onExitComplete={onFinishClose}>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={enableClickOutsideClose ? handleClose : undefined}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2 }}
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === "string" ? title : "Modal"}
            className={cn(
              "bg-white dark:bg-dark-900 w-full rounded-2xl shadow-2xl border border-white/10 overflow-hidden flex flex-col max-h-[90vh] relative",
              sizes[size],
              className,
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {(title || showClose) && (
              <div className="flex justify-between items-center p-5 border-b border-gray-100 dark:border-white/5">
                {title && (
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                    {title}
                  </h2>
                )}
                {showClose && (
                  <button
                    onClick={handleClose}
                    className="text-gray-400 hover:text-gray-500 dark:hover:text-white transition-colors p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded-full absolute top-4 right-4"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>
            )}

            <div className="p-6 overflow-y-auto custom-scrollbar">
              {renderChildren && typeof renderChildren === "function" ? (
                <RenderChildrenWrapper
                  fn={renderChildren}
                  close={cancel}
                  confirm={confirm}
                />
              ) : (
                (renderChildren ?? content)
              )}
            </div>

            {(confirmText || cancelText) && (
              <div className="flex justify-end gap-3 p-4 bg-gray-50 dark:bg-white/5 border-t border-gray-100 dark:border-white/5">
                {cancelText && (
                  <Button size="lg" variant="ghost" onClick={cancel}>
                    {cancelText}
                  </Button>
                )}
                {confirmText && (
                  <Button size="lg" onClick={confirm}>
                    {confirmText}
                  </Button>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
