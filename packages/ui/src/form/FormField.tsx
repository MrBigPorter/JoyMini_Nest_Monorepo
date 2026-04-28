import React from "react";
import {
  Controller,
  useFormContext,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";

/**
 * FormField is a generic wrapper component for React Hook Form's Controller.
 *
 * It provides a simplified way to render controlled form components with built-in error handling.
 *
 * It uses `useFormContext` to access the `control` object, so it must be used within a `FormProvider`.
 *
 * @template TFieldValues - The shape of the form data, usually passed from useForm<T>().
 * @template TName - The specific field name within TFieldValues that this FormField binds to.
 *
 * @param name - The name of the field to control, must exist in TFieldValues.
 * @param children - A render function that receives the `field` props and the validation `error` string.
 *
 * @example
 * ```tsx
 * <FormField<MyFormValues, 'email'>
 *   name="email"
 *   children={({ field, error }) => (
 *     <>
 *       <Input {...field} />
 *       {error && <p className="text-red-500">{error}</p>}
 *     </>
 *   )}
 * />
 * ```
 */
type RenderProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> = {
  field: ControllerRenderProps<TFieldValues, TName>;
  error?: string;
};
export function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  name,
  renderAction,
}: Readonly<{
  name: TName;
  renderAction: (props: RenderProps<TFieldValues, TName>) => React.ReactElement;
}>) {
  const { control } = useFormContext<TFieldValues>();

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        const error = fieldState.error?.message;
        return renderAction({
          field,
          error,
        });
      }}
    />
  );
}
