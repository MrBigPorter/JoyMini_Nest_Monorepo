import React, { ReactNode } from "react";
import type { FieldValues } from "react-hook-form";
import clsx from "clsx";
import { AnimatePresence } from "framer-motion";

import {
  FormControl,
  FormField,
  FormHelpTextVariants,
  FormItem,
  FormLabel,
  FormLabelVariants,
  FormMessage,
  FormMessageVariants,
  HelpText,
} from "./index";
import type { BaseFieldProps } from "./types/baseFieldType";
import { useFormTheme } from "./formTheme/FormThemeProvider";
import { getVariantClassNames } from "./formTheme";
import { twMerge } from "tailwind-merge";
import * as MediaUploader from "../components/MediaUploader";
import { RenderImageProps } from "../components/MediaUploader/types.ts";

type FormMediaUploaderFieldProps<
  TFieldValues extends FieldValues = FieldValues,
> = Omit<
  BaseFieldProps<TFieldValues>,
  | "placeholder"
  | "type"
  | "inputMode"
  | "autoComplete"
  | "renderLeft"
  | "renderRight"
> & {
  maxFileCount?: number;
  accept?: Record<string, string[]>; // react-dropzone Accept type: { 'image/*': ['.png', '.jpg'] }
  showRemoveButton?: boolean;
  previewClassName?: string;
  labelClassName?: string;
  buttonClassName?: string;
  helpTextClassName?: string;
  renderItem?: (props: MediaUploader.RenderItemProps) => React.ReactNode;
  renderButton?: (openFilePicker?: () => void) => ReactNode;
  renderImage?: (props: RenderImageProps) => React.ReactNode;
};

export function FormMediaUploaderField<
  TFieldValues extends FieldValues = FieldValues,
>({
  name,
  label,
  renderLabelRight,
  required,
  classNames = {},
  testId,
  size = "md",
  helpText,
  variant = "default",
  layout = "vertical",
  showRemoveButton = true,
  renderItem,
  renderButton,
  labelClassName,
  buttonClassName,
  previewClassName,
  helpTextClassName,
  accept,
  maxFileCount,
  renderImage,
}: Readonly<FormMediaUploaderFieldProps<TFieldValues>>) {
  const theme = useFormTheme();

  return (
    <FormField<TFieldValues, typeof name>
      name={name}
      renderAction={({ field, error }) => {
        const finalVariant = error ? "error" : variant;

        const handleUpload = (files: File[]) => {
          if (maxFileCount === 1) {
            const file = files[0];

            // 对应 schema: string | File
            // - 如果是新建：这里会是 File
            // - 如果删除了：传 ""，触发必填校验
            field.onChange(file ?? "");
          } else {
            // 多图场景以后要用再说，这里可以直接放 File[]
            field.onChange(files);
          }
        };

        return (
          <FormItem>
            <div
              className={clsx({
                "flex gap-[10px]": layout === "horizontal",
                "flex flex-col gap-[10px]": layout !== "horizontal",
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
                    labelClassName,
                  )}
                >
                  {label}
                  {label && required && "*"}
                  {renderLabelRight?.()}
                </FormLabel>
              )}

              <div
                data-testid={`${testId}-media-uploader-field`}
                className={clsx({
                  "flex-1": layout === "horizontal",
                })}
              >
                <FormControl asChild>
                  <MediaUploader.Root
                    value={field.value}
                    maxFileCount={maxFileCount}
                    accept={accept}
                    onUpload={handleUpload}
                  >
                    <MediaUploader.Preview
                      className={previewClassName}
                      showRemoveButton={showRemoveButton}
                      renderItem={renderItem}
                      renderImage={renderImage}
                      renderButton={(openFilePicker) =>
                        renderButton ? (
                          renderButton(openFilePicker)
                        ) : (
                          <MediaUploader.Button className={buttonClassName} />
                        )
                      }
                    />
                  </MediaUploader.Root>
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
                      helpTextClassName,
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
