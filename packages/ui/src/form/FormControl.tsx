import { Slot } from "@radix-ui/react-slot";
import React from "react";
/**
 * Props for the FormControl component.
 *
 * - `asChild`: If `true`, renders the child element directly (using Radix UI's `Slot`).
 * - Inherits all standard HTML div attributes.
 */
export interface FormControlProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean;
}
/**
 * `FormControl` is a flexible wrapper component used to wrap input-related components
 * like `<input>`, `<textarea>`, or custom inputs within a form item layout.
 *
 * By default, it renders a `div`, but you can pass `asChild` to render a different component
 * using `Slot` for better composition and flexibility.
 *
 * @example
 * // Default usage
 * <FormControl>
 *   <input type="text" />
 * </FormControl>
 *
 * @example
 * // Using asChild to avoid unnecessary div
 * <FormControl asChild>
 *   <input type="text" />
 * </FormControl>
 */
export const FormControl = React.forwardRef<HTMLDivElement, FormControlProps>(
  ({ asChild = false, className, ...props }, ref) => {
    const Comp = asChild ? Slot : "div";
    return <Comp {...props} ref={ref} className={className} {...props} />;
  },
);

FormControl.displayName = "FormControl";
