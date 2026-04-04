import type { FieldValues } from "react-hook-form";
import clsx from "clsx";
import { AnimatePresence } from "framer-motion";

import { FormField } from "./FormField";
import { FormItem } from "./FormItem";
import { FormLabel } from "./FormLabel";
import { FormMessage } from "./FormMessage";
import { FormControl } from "./FormControl";
import { HelpText } from "./HelpText";

import {
  FormHelpTextVariants,
  FormLabelVariants,
  FormMessageVariants,
} from "./constants";
import type { BaseFieldProps } from "./types/baseFieldType";
import { useFormTheme } from "./formTheme/FormThemeProvider";
import { getVariantClassNames } from "./formTheme";
import { cn } from "../lib/utils";
import { FormTextarea } from "./FormTextarea";

export function FormTextareaField<
  TFieldValues extends FieldValues = FieldValues,
>({
  name,
  label,
  renderLabelRight,
  placeholder,
  disabled,
  readOnly,
  required,
  classNames = {},
  inputMode,
  autoComplete,
  data,
  testId,
  size = "md",
  helpText,
  variant = "default",
  layout = "vertical",
}: Readonly<BaseFieldProps<TFieldValues>>) {
  const theme = useFormTheme();

  return (
    <FormField<TFieldValues, typeof name>
      name={name}
      renderAction={({ field, error }) => {
        const finalVariant = error ? "error" : variant;

        return (
          <FormItem>
            <div
              data-testid={`item-${testId}`}
              className={clsx({
                "w-full flex items-start gap-[10px]": layout === "horizontal",
                "w-full flex flex-col gap-[10px]": layout !== "horizontal",
              })}
            >
              {label && (
                <FormLabel
                  testId={`label-${testId}`}
                  className={cn(
                    FormLabelVariants({ size, variant: finalVariant }),
                    getVariantClassNames(
                      theme,
                      finalVariant,
                      classNames,
                      "label",
                    ),
                  )}
                >
                  {label}
                  {label && required && "*"}
                  {renderLabelRight?.()}
                </FormLabel>
              )}

              <div
                className={clsx({
                  "flex-1": layout === "horizontal",
                })}
              >
                <FormControl asChild>
                  <FormTextarea
                    {...field}
                    data-testid={`textarea-${testId}`}
                    placeholder={placeholder}
                    readOnly={readOnly}
                    disabled={disabled}
                    rows={4}
                    inputMode={inputMode}
                    autoComplete={autoComplete}
                    className={cn(
                      "border border-gray-200 dark:border-white/10 " +
                        "focus:ring-2 focus:border-primary-500 focus:ring-primary-500/50",
                      finalVariant === "error" &&
                        "border-red-500 focus:border-red-500 focus:ring-red-500/50",
                      getVariantClassNames(
                        theme,
                        finalVariant,
                        classNames,
                        "input",
                      ),
                    )}
                    onChange={(e) => {
                      field.onChange(e);
                      data?.onChange?.(
                        e as unknown as React.ChangeEvent<HTMLInputElement>,
                      );
                    }}
                    onBlur={(e) => {
                      field.onBlur();
                      data?.onBlur?.(
                        e as unknown as React.FocusEvent<HTMLInputElement>,
                      );
                    }}
                    onFocus={(e) => {
                      data?.onFocus?.(
                        e as unknown as React.FocusEvent<HTMLInputElement>,
                      );
                    }}
                    onKeyDown={(e) => {
                      data?.onKeyDown?.(
                        e as unknown as React.KeyboardEvent<HTMLInputElement>,
                      );
                    }}
                  />
                </FormControl>

                {helpText && (
                  <HelpText
                    testId={`help-text-${testId}`}
                    content={helpText}
                    className={cn(
                      FormHelpTextVariants({ size, variant: finalVariant }),
                      getVariantClassNames(
                        theme,
                        finalVariant,
                        classNames,
                        "helpText",
                      ),
                    )}
                  />
                )}

                <AnimatePresence mode="wait" initial={false}>
                  {error && (
                    <FormMessage
                      testId={`message-${testId}`}
                      key={error}
                      error={error}
                      className={cn(
                        FormMessageVariants({ variant: finalVariant }),
                        getVariantClassNames(
                          theme,
                          finalVariant,
                          classNames,
                          "message",
                        ),
                      )}
                    />
                  )}
                </AnimatePresence>
              </div>
            </div>
          </FormItem>
        );
      }}
    />
  );
}
