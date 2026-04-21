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
  label: unknown;
  value: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export interface SelectGroupOption {
  label: string;
  items: SelectOption[];
}

export type BaseSelectOptions = SelectOption[] | SelectGroupOption[];

export interface BaseSelectProps extends Omit<
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
  //  安全渲染：永远不会直接渲染对象，防止React错误
  const renderLabel = (): React.ReactNode => {
    // 1. 已经是 React 节点直接返回
    if (React.isValidElement(item.label)) {
      return item.label;
    }

    // 2. 字符串直接返回
    if (typeof item.label === "string") {
      return item.label;
    }

    // 3. 数字转字符串
    if (typeof item.label === "number") {
      return String(item.label);
    }

    // 4. 处理 LocalizedString 多语言对象（en/zh 结构）
    if (typeof item.label === "object" && item.label !== null) {
      const localizedObj = item.label as Record<string, unknown>;

      // 安全地尝试提取多语言值，优先中文，然后英文
      if (typeof localizedObj.zh === "string") return localizedObj.zh;
      if (typeof localizedObj.en === "string") return localizedObj.en;

      // 遍历所有属性找第一个字符串值
      for (const key in localizedObj) {
        if (typeof localizedObj[key] === "string") {
          return localizedObj[key] as string;
        }
      }
    }

    // 5. 最终降级：使用 value 作为兜底
    return String(item.value);
  };

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
        <span className="truncate">{renderLabel()}</span>
      </div>
    </SelectItem>
  );
};
