import React, { useCallback } from "react";
import type { ControllerRenderProps, Path } from "react-hook-form";
import clsx from "clsx";
import { AnimatePresence } from "framer-motion";
import type { FieldValues } from "react-hook-form";

import { FormField } from "./FormField";
import { FormItem } from "./FormItem";
import { FormLabel } from "./FormLabel";
import { FormMessage } from "./FormMessage";
import { FormControl } from "./FormControl";
import {
  FormHelpTextVariants,
  FormLabelVariants,
  FormMessageVariants,
} from "./constants";
import { HelpText } from "./HelpText";
import { useFormTheme } from "./formTheme/FormThemeProvider";
import { getVariantClassNames } from "./formTheme";
import type { BaseFieldProps } from "./types/baseFieldType";
import type { BaseSelectProps } from "../components/BaseSelect/type";
import { BaseSelect } from "../components";
import { twMerge } from "tailwind-merge";

/**
 * 注意：不把 value / onChange 透传给外面，统一由 RHF 接管
 */
type FormSelectFieldProps<TFieldValues extends FieldValues = FieldValues> =
  Omit<
    BaseFieldProps<TFieldValues>,
    | "type"
    | "inputMode"
    | "autoComplete"
    | "renderLeft"
    | "renderRight"
    | "readOnly"
  > &
    Omit<BaseSelectProps, "value" | "onChange"> & {
      /** 是否把选中的值当作数字来处理 */
      numeric?: boolean;
    };

export function FormSelectField<
  TFieldValues extends FieldValues = FieldValues,
>({
  name,
  label,
  renderLabelRight,
  placeholder,
  disabled,
  required,
  classNames = {},
  testId,
  size = "md",
  helpText,
  variant = "default",
  layout = "vertical",
  options,
  onOpenChange,
  numeric = false,
  ...props
}: Readonly<FormSelectFieldProps<TFieldValues>>) {
  const theme = useFormTheme();

  // 顶层 useCallback 工厂，返回稳定的 handleChange
  const getHandleChange = useCallback(
    <TField extends FieldValues = FieldValues>(
      field: ControllerRenderProps<TField, Path<TField>>,
      numeric: boolean,
    ) =>
      (val: string) => {
        let nextValue: string | number | undefined = val;
        if (val === "" || val === undefined || val === null) {
          nextValue = undefined; // 清空
        } else if (numeric) {
          nextValue = Number(val); // 强转回数字
        }
        field.onChange(nextValue);
      },
    [],
  );

  return (
    <FormField<TFieldValues, typeof name>
      name={name}
      renderAction={({ field, error }) => {
        const finalVariant = error ? "error" : variant;

        const selectValue =
          field.value === undefined ||
          field.value === null ||
          field.value === "" ||
          field.value === 0
            ? undefined
            : String(field.value);

        // 生成稳定的 handleChange，依赖 field 和 numeric
        const handleChange = getHandleChange(field, numeric);

        return (
          <FormItem>
            <div
              data-testid={testId}
              className={clsx({
                "flex items-center gap-[10px]": layout === "horizontal",
                "flex flex-col gap-[5px]": layout !== "horizontal",
              })}
            >
              {label && (
                <FormLabel
                  className={twMerge(
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
                  <BaseSelect
                    key={String(selectValue)}
                    options={options}
                    placeholder={placeholder}
                    disabled={disabled}
                    value={selectValue}
                    onOpenChange={onOpenChange}
                    onChange={handleChange}
                    {...props}
                  />
                </FormControl>

                {helpText && (
                  <HelpText
                    content={helpText}
                    className={twMerge(
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
                      key={error}
                      error={error}
                      className={twMerge(
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
