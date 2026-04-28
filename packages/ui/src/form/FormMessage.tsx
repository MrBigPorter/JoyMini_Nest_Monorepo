import { motion } from "framer-motion";
import { useFormItemContext } from "./FormItem.tsx";
import React from "react";
import { twMerge } from "tailwind-merge";

/**
 * FormMessage displays an error or helper message below a form field.
 *
 * It automatically pulls the current form field ID from `FormItemContext`
 * and attaches it as `id="${id}-error"` to support `aria-describedby` accessibility.
 *
 * It accepts either an `error` string prop, or `children` (for custom JSX).
 *
 * Should be used within a `<FormItem>` component.
 *
 * @param error - Optional error message string
 * @param children - Optional custom JSX message instead of plain string
 * @param className - Additional className for styling
 * @example
 * <FormMessage error={formState.errors.username?.message} />
 * @example
 * <FormMessage>
 *   <span className="italic">This field is required</span>
 * </FormMessage>
 */
export interface FormMessageProps extends React.HTMLAttributes<HTMLParagraphElement> {
  error?: string;
  testId?: string;
}
export const FormMessage = React.forwardRef<
  HTMLParagraphElement,
  FormMessageProps
>(({ error, className, children, testId }, ref) => {
  const { id } = useFormItemContext();
  const content = error ?? children;
  const keyString =
    typeof content === "string" ? content : testId || id || "form-message";
  return (
    <motion.p
      data-testid={testId}
      key={keyString}
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{
        opacity: 0,
        x: -6,
        transition: {
          duration: 0.2,
          ease: "easeInOut",
        },
      }}
      transition={{ duration: 0.2 }}
      ref={ref}
      id={`${id}-error`}
      className={twMerge("w-full mt-[1px] text-[14px] text-red-500", className)}
    >
      {content}
    </motion.p>
  );
});
// Ensure the component has a display name for debugging
FormMessage.displayName = "FormMessage";
