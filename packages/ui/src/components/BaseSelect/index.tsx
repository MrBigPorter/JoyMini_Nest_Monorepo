import * as React from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { cn } from "../../lib/utils";
import { Loader2 } from "lucide-react";

export interface SelectOption {
  label: string;
  value: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export interface SelectGroupOption {
  label: string;
  items: SelectOption[];
}

export type BaseSelectOptions = SelectOption[] | SelectGroupOption[];

export interface BaseSelectProps
  extends Omit<
    React.ComponentPropsWithoutRef<typeof Select>,
    "value" | "onValueChange"
  > {
  value?: string;
  onChange?: (value: string) => void;
  options: BaseSelectOptions;
  placeholder?: string;
  className?: string;
  contentClassName?: string;
  containerClassName?: string;
  /** 和 Input 对齐：可以是 string（错误文案），也可以是 boolean */
  error?: string | boolean;
  isLoading?: boolean;
  label?: string;
  emptyText?: string;
}

function isGrouped(options: BaseSelectOptions): options is SelectGroupOption[] {
  return options.length > 0 && "items" in options[0];
}

export const BaseSelect = React.forwardRef<HTMLButtonElement, BaseSelectProps>(
  (
    {
      value,
      onChange,
      options,
      placeholder = "请选择",
      className,
      contentClassName,
      containerClassName,
      disabled,
      error,
      isLoading,
      label,
      emptyText = "暂无数据",
      ...props
    },
    ref,
  ) => {
    const safeValue =
      value !== undefined && value !== null ? String(value) : "";

    const hasError = !!error;

    return (
      <div className={cn("w-full", containerClassName)}>
        {/* Label：跟 Input 的一样 */}
        {label && (
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            {label}
          </label>
        )}

        <Select
          value={safeValue}
          onValueChange={onChange}
          disabled={disabled || isLoading}
          {...props}
        >
          <SelectTrigger
            ref={ref}
            className={cn(
              "w-full py-3 px-4 bg-gray-50 dark:bg-black/20 border rounded-lg outline-none transition-all text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 flex items-center focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500",
              hasError
                ? "border-red-500"
                : "border-gray-200 dark:border-white/10",
              className,
            )}
          >
            <div className="flex items-center gap-2 truncate">
              {isLoading && (
                <Loader2 className="h-4 w-4 animate-spin text-gray-400 dark:text-gray-500" />
              )}
              <SelectValue
                placeholder={placeholder}
                className="text-gray-900 dark:text-white data-[placeholder]:text-gray-400 dark:data-[placeholder]:text-gray-600"
              />
            </div>
          </SelectTrigger>

          <SelectContent
            className={cn(
              "w-full appearance-none px-4 py-2.5 bg-gray-50 border border-gray-200 dark:border-white/10 rounded-lg focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 outline-none transition-all dark:text-black",
              contentClassName,
            )}
            position="popper"
            style={{ width: "var(--radix-select-trigger-width)" }}
          >
            {options.length === 0 && (
              <div className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">
                {emptyText}
              </div>
            )}

            {isGrouped(options)
              ? options.map((group, index) => (
                  <React.Fragment key={group.label}>
                    <SelectGroup>
                      <SelectLabel className="px-2 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400">
                        {group.label}
                      </SelectLabel>
                      {group.items
                        .filter((item) => item.value !== "")
                        .map((item) => (
                          <RenderSelectItem key={item.value} item={item} />
                        ))}
                    </SelectGroup>
                    {index < options.length - 1 && <SelectSeparator />}
                  </React.Fragment>
                ))
              : (options as SelectOption[])
                  .filter((item) => item.value !== "")
                  .map((item) => (
                    <RenderSelectItem key={item.value} item={item} />
                  ))}
          </SelectContent>
        </Select>

        {typeof error === "string" && (
          <span className="mt-1 block text-xs text-red-500">{error}</span>
        )}
      </div>
    );
  },
);

BaseSelect.displayName = "BaseSelect";

const RenderSelectItem = ({ item }: { item: SelectOption }) => {
  return (
    <SelectItem
      value={String(item.value)}
      disabled={item.disabled}
      className="cursor-pointer text-sm text-gray-800 hover:bg-gray-100"
    >
      <div className="flex items-center gap-2">
        {item.icon && (
          <span className="flex h-4 w-4 items-center justify-center text-gray-400 dark:text-gray-500">
            {item.icon}
          </span>
        )}
        <span className="truncate">{item.label}</span>
      </div>
    </SelectItem>
  );
};
