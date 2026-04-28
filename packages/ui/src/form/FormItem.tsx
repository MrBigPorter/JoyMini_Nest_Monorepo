import { motion } from "framer-motion";
import React, { useMemo } from "react";
/**
 * FormItemContext provides a unique `id` to all nested form components
 * (e.g., <FormLabel>, <FormInput>, <FormMessage>), allowing them to stay
 * synchronized for accessibility (aria attributes, htmlFor binding).
 */
const FormItemContext = React.createContext<{ id: string } | null>(null);

/**
 * `<FormItem>` is a wrapper component for a form field block.
 *
 * It generates a unique ID using `React.useId()` and provides it to all
 * its descendants via React Context. This allows child components like
 * `<FormLabel>`, `<FormInput>`, and `<FormMessage>` to:
 *
 * - Use a shared `id` for proper HTML `label`-to-`input` linkage
 * - Apply `aria-describedby` to connect input to error messages
 * - Avoid prop drilling by automatically sharing context
 *
 * @example
 * ```tsx
 * <FormItem>
 *   <FormLabel>Email</FormLabel>
 *   <FormInput />
 *   <FormMessage error="Email is required" />
 * </FormItem>
 * ```
 */
export const FormItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children }, ref) => {
  const id = React.useId();
  const contextValue = useMemo(() => ({ id }), [id]);
  return (
    <FormItemContext.Provider value={contextValue}>
      <motion.div
        ref={ref}
        className={className}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
      >
        {children}
      </motion.div>
    </FormItemContext.Provider>
  );
});
/**
 * Custom hook to access the shared `id` provided by `<FormItem>`.
 *
 * This hook is intended to be used by components like `FormLabel`,
 * `FormInput`, and `FormMessage` to sync their attributes with the
 * shared ID context.
 *
 * @throws Error if used outside of a `<FormItem>` block.
 *
 * @returns { id: string } - The shared unique ID
 */
type ReturnType = {
  id: string;
};
export const useFormItemContext = (): ReturnType => {
  const context = React.useContext(FormItemContext);
  if (!context) throw new Error("必须放在 <FormItem> 中使用");
  return context;
};

FormItem.displayName = "FormItem";
