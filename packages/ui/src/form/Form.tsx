import {
  type FieldValues,
  FormProvider,
  type UseFormReturn,
} from "react-hook-form";
import { ReactNode } from "react";

/**
 * Props for the `Form` component.
 *
 * This extends `UseFormReturn<T>` so you can directly spread your `useForm()` object,
 * along with any React children (form elements, inputs, etc).
 *
 * @template T - The type of your form schema, typically inferred from zod or yup.
 */
interface Props<T extends FieldValues> extends UseFormReturn<T> {
  children: ReactNode;
}

/**
 * `Form` is a lightweight wrapper around React Hook Form's `FormProvider`.
 *
 * It allows you to write:
 *
 * ```tsx
 * <Form {...form}>
 *   <YourFields />
 * </Form>
 * ```
 *
 * Instead of:
 *
 * ```tsx
 * <FormProvider {...form}>
 *   <YourFields />
 * </FormProvider>
 * ```
 *
 * This pattern improves readability and ensures your form fields
 * have access to RHF's context (e.g. useFormContext()).
 */
export function Form<T extends FieldValues>(props: Readonly<Props<T>>) {
  const { children, ...form } = props;
  return <FormProvider {...form}>{children}</FormProvider>;
}
