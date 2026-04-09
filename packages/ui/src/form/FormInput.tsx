import React from "react";
import { useFormItemContext } from "./FormItem.tsx";
import { AutoCompleteOption, InputModeOption } from "./constants.ts";
import { twMerge } from "tailwind-merge";

/**
 * FormInput is a reusable input field integrated with FormItem context.
 *
 * It auto-binds `id` from the nearest <FormItem /> to support proper label association.
 * Supports full native input attributes and ref forwarding.
 *
 * @param props - Standard input attributes plus context-injected ID
 * @returns React <input> element
 *
 * @example
 * <FormItem>
 *   <FormLabel>Email</FormLabel>
 *   <FormInput placeholder="Enter email" type="email" />
 *   <FormMessage />
 * </FormItem>
 */
export const FormInput = React.forwardRef<
  HTMLInputElement,
  Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "autoComplete" | "inputMode"
  > & {
    inputMode?: InputModeOption;
    autoComplete?: AutoCompleteOption;
    className?: string;
    testId?: string;
  }
>(({ inputMode, autoComplete, className, testId, ...props }, ref) => {
  const { id } = useFormItemContext();
  const errorId = `${id}-message`;
  const { value, defaultValue, ...restProps } = props;

  // ✅ 修复React警告：input不能接受null作为value，统一转换为空字符串
  const safeValue = value === null ? "" : value;
  const safeDefaultValue = defaultValue === null ? "" : defaultValue;

  const valueProps =
    safeValue !== undefined
      ? { value: safeValue }
      : safeDefaultValue !== undefined
        ? { defaultValue: safeDefaultValue }
        : {};

  return (
    <input
      id={id}
      data-testid={testId}
      aria-describedby={errorId}
      aria-invalid={!!props["aria-invalid"] || undefined}
      className={twMerge(
        "w-full outline-none ring-0 focus:outline-none focus:ring-0 focus:border-transparent",
        className,
      )}
      ref={ref}
      autoComplete={autoComplete}
      inputMode={inputMode}
      {...restProps}
      {...valueProps}
    />
  );
});

FormInput.displayName = "FormInput";
