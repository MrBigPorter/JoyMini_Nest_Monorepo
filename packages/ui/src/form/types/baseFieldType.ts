import type { FieldPath, FieldValues } from "react-hook-form";
import { AutoCompleteOption, InputModeOption } from "../constants.ts";
import { FormThemeVariantsClass, VariantKey } from "./themeType.ts";

export interface BaseFieldProps<
  TFieldValues extends FieldValues = FieldValues,
> {
  /** Field name, must match key in form schema (e.g. 'email') */
  name: FieldPath<TFieldValues>;
  /** Optional label text displayed above the input */
  label?: string;
  /** Custom label renderer function, allows for more complex label rendering */
  renderLabelRight?: () => React.ReactNode;
  /** Placeholder text for the input field */
  placeholder?: string;
  /** Whether the field is required (adds a * after the label) */
  required?: boolean;
  /** Whether the input is read-only */
  readOnly?: boolean;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Custom class names for styling various parts of the component */
  classNames?: Partial<FormThemeVariantsClass> & {
    [key in VariantKey]?: Partial<FormThemeVariantsClass>;
  };
  /** HTML input type (e.g. 'text', 'password', 'email') */
  type?: string;
  /**
   * Specifies the input mode for the field (e\.g\., text, numeric)\. Helps browsers optimize the keyboard layout\.
   */
  inputMode?: InputModeOption;
  /**
   * Suggests to the browser how to auto\-complete the field \(e\.g\., email, username\)\.
   */
  autoComplete?: AutoCompleteOption;
  /**
   * Allows rendering a custom React node \(such as an icon\) on the left side of the input\.
   */
  renderLeft?: (data?: unknown) => React.ReactNode;
  /**
   * Allows rendering a custom React node on the right side of the input\.
   */
  renderRight?: (data?: unknown) => React.ReactNode;
  data?: {
    /** Called when the input value changes */
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
    /** Called when the input loses focus */
    onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void;
    /** Called when a key is pressed in the input */
    onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
    /** Called when the input receives focus */
    onFocus?: (event: React.FocusEvent<HTMLInputElement>) => void;
  };
  /** Optional test ID for querying the element in tests (e.g., data-testid) */
  testId?: string;
  /** Optional size variant for the input, can be 'sm', 'md', or 'lg' */
  size?: "sm" | "md" | "lg";
  /** Optional help text displayed below the input */
  helpText?: string | React.ReactNode;
  /** Optional variant for the input, can be 'default', 'error', 'success', or 'warning' */
  variant?: VariantKey;
  /** Layout type for the form item, can be 'horizontal' or 'vertical' */
  layout?: "horizontal" | "vertical";
  /** Maximum character length for textarea/input fields, shows a character counter */
  maxLength?: number;
}
