import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { cn } from "./lib/utils";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "danger"
  | "ghost"
  | "outline"
  | "success"
  | "warning"
  | "info"
  | "link";

const buttonVariants = cva(
  "rounded-lg font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        primary:
          "bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-lg shadow-primary-500/30 border border-transparent hover:from-primary-600 hover:to-primary-700",
        secondary:
          "bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-200 border border-transparent hover:bg-gray-200 dark:hover:bg-white/20",
        danger:
          "bg-red-500 text-white shadow-lg shadow-red-500/30 border border-transparent hover:bg-red-600",
        ghost:
          "text-gray-500 dark:text-gray-400 bg-transparent hover:bg-gray-100 dark:hover:bg-white/5",
        outline:
          "bg-transparent border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5",

        // 成功/通过 (适合：审核通过、保存成功)
        // 使用 emerald 或 green，带绿色阴影
        success:
          "bg-emerald-500 text-white shadow-lg shadow-emerald-500/30 border border-transparent hover:bg-emerald-600",

        // 警告/需注意 (适合：冻结、暂停、退回)
        // 使用 amber 或 orange (注意：yellow-500 配白色文字对比度通常不够，建议用 amber)
        warning:
          "bg-amber-500 text-white shadow-lg shadow-amber-500/30 border border-transparent hover:bg-amber-600",

        // 新增：信息/提示 (适合：查看详情、日志、帮助)
        // 使用 blue 或 sky，区别于 primary 的渐变色，这个通常是纯色
        info: "bg-blue-500 text-white shadow-lg shadow-blue-500/30 border border-transparent hover:bg-blue-600",

        // 链接样式 (适合：表格内跳转、由按钮伪装的链接)
        link: "text-primary-500 underline-offset-4 hover:underline bg-transparent border-none shadow-none px-0",
      },
      size: {
        default: "px-6 py-3 text-lg",
        sm: "px-3 py-1.5 text-sm",
        md: "px-4 py-2",
        lg: "px-6 py-3 text-lg",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  isLoading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      isLoading = false,
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    if (asChild) {
      return (
        <Slot
          className={cn(buttonVariants({ variant, size, className }))}
          {...(props as Record<string, unknown>)}
        >
          {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          {children}
        </Slot>
      );
    }

    return (
      <motion.button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={isLoading || disabled} // loading 时自动禁用
        whileHover={{ scale: 1.02, filter: "brightness(1.1)" }}
        whileTap={{ scale: 0.95 }}
        {...(props as Record<string, unknown>)}
      >
        {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </motion.button>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
