"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button, cn } from "@repo/ui";
import { Plus, ChevronLeft } from "lucide-react";
import { Breadcrumbs } from "@/components/UIComponents";

interface PageHeaderProps {
  /** 页面大标题 */
  title: string;
  /** 页面描述/副标题 */
  description?: string;
  /** 是否显示返回按钮 */
  showBackButton?: boolean;
  /** 返回按钮点击事件，未提供时默认使用 router.back() */
  onBack?: () => void;
  /** 返回按钮文本，默认为 "Back" */
  backButtonLabel?: string;
  /** 返回按钮图标，默认为 ChevronLeft */
  backButtonIcon?: React.ReactNode;
  /** 面包屑导航项（字符串数组） */
  breadcrumbs?: string[];
  /** 中间区域 (搜索框/输入框)，会自动占据剩余空间 */
  searchBar?: React.ReactNode;
  /** 右侧操作区 (通常放按钮) */
  action?: React.ReactNode;
  /** 额外的容器样式 */
  className?: string;
  /** 可选按钮文本 */
  buttonText?: string;
  /** 可选按钮点击事件 */
  buttonOnClick?: () => void;
  /** 按钮前缀图标，默认为加号图标 */
  buttonPrefixIcon?: React.ReactNode;
  /** 是否显示按钮图标，默认为 true */
  showButtonIcon?: boolean;
  /** 按钮禁用状态 */
  buttonDisabled?: boolean;
  /** 次要按钮文本 */
  secondaryButtonText?: string;
  /** 次要按钮点击事件 */
  secondaryButtonOnClick?: () => void;
  /** 第三按钮文本 */
  tertiaryButtonText?: string;
  /** 第三按钮点击事件 */
  tertiaryButtonOnClick?: () => void;
  /** 第三按钮图标 */
  tertiaryButtonIcon?: React.ReactNode;
  /** 第三按钮变体 */
  tertiaryButtonVariant?:
    | "outline"
    | "secondary"
    | "ghost"
    | "link"
    | "primary"
    | "danger"
    | "success"
    | "warning"
    | "info";
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  showBackButton = false,
  onBack,
  backButtonLabel = "Back",
  backButtonIcon = <ChevronLeft size={18} />,
  breadcrumbs,
  searchBar, // 新增
  action,
  className,
  buttonText,
  buttonOnClick,
  buttonPrefixIcon = <Plus size={18} />,
  showButtonIcon = true,
  buttonDisabled = false,
  secondaryButtonText,
  secondaryButtonOnClick,
  tertiaryButtonText,
  tertiaryButtonOnClick,
  tertiaryButtonIcon,
  tertiaryButtonVariant = "primary",
}) => {
  const router = useRouter();

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      router.back();
    }
  };

  return (
    // 1. 移除了 justify-between，改用 gap-4 控制间距
    <div className={cn("flex items-center gap-4 mb-6", className)}>
      {/* 2. 左侧标题区：添加 shrink-0 防止被压缩 */}
      <div className="shrink-0">
        {(showBackButton || breadcrumbs) && (
          <div className="flex items-center gap-2 mb-2">
            {showBackButton && (
              <Button
                onClick={handleBack}
                variant="ghost"
                size="sm"
                className="p-1 h-auto text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                aria-label={backButtonLabel}
              >
                {backButtonIcon}
                <span className="sr-only">{backButtonLabel}</span>
              </Button>
            )}
            {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
          </div>
        )}
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
          {title}
        </h1>
        {description && (
          <p className="text-gray-500 text-sm mt-1">{description}</p>
        )}
      </div>

      {/* 3. 中间区域：flex-1 是关键，它会吃掉所有剩余空间 */}
      {/* 如果没有 searchBar，这个空 div 配合 flex-1 依然会把左右两边推到边缘 */}
      <div className="flex-1">{searchBar}</div>

      {/* 4. 右侧操作区：添加 shrink-0 防止被压缩，并保持右对齐 */}
      <div className="flex items-center gap-2 shrink-0">
        {action}

        {/* 次要按钮 */}
        {secondaryButtonText && secondaryButtonOnClick && (
          <Button
            onClick={secondaryButtonOnClick}
            variant="outline"
            className="gap-2.5"
          >
            {secondaryButtonText}
          </Button>
        )}

        {/* 第三按钮 */}
        {tertiaryButtonText && tertiaryButtonOnClick && (
          <Button
            onClick={tertiaryButtonOnClick}
            variant={tertiaryButtonVariant}
            className="gap-2.5"
          >
            {tertiaryButtonIcon && tertiaryButtonIcon}
            {tertiaryButtonText}
          </Button>
        )}

        {/* 主要按钮 */}
        {buttonText && buttonOnClick && (
          <Button
            onClick={buttonOnClick}
            disabled={buttonDisabled}
            className="gap-2.5"
          >
            {showButtonIcon && buttonPrefixIcon}
            {buttonText}
          </Button>
        )}
      </div>
    </div>
  );
};
