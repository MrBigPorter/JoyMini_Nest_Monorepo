"use client";

import React from "react";
import { Button } from "@repo/ui";
import { cn } from "@repo/ui";
import { useTranslation, type TFunc } from "@/hooks/useTranslation";

interface PaginationProps {
  /** 当前页码 */
  current: number;
  /** 每页条数 */
  pageSize: number;
  /** 总条数 */
  total: number;
  /** 翻页回调 */
  onChange: (page: number, pageSize: number) => void;
  /** 额外的样式类 */
  className?: string;
  /**
   * Optional t function for use inside ModalManager (no NextIntlClientProvider context).
   * When provided, Pagination uses it instead of calling useTranslation() internally.
   */
  t?: TFunc;
}

/**
 * Inner implementation that requires a t function.
 */
const PaginationInner: React.FC<PaginationProps & { t: TFunc }> = ({
  current,
  pageSize,
  total,
  onChange,
  className,
  t,
}) => {
  // 计算总页数，防止除以0或向上取整错误
  const totalPage = Math.max(1, Math.ceil(total / pageSize));

  // 是否是第一页或最后一页
  const isFirstPage = current <= 1;
  const isLastPage = current >= totalPage;

  return (
    <div
      className={cn(
        "flex justify-between items-center mt-4 text-sm text-gray-500",
        className,
      )}
    >
      {/* 左侧：总数显示 */}
      <div>{t("common_total", { count: total })}</div>

      {/* 右侧：翻页操作 */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange(current - 1, pageSize)}
          disabled={isFirstPage}
          className="h-8 px-3"
        >
          {t("common_previous")}
        </Button>

        <span className="mx-2 text-xs font-medium">
          {t("common_pageOf", { current, total: totalPage })}
        </span>

        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange(current + 1, pageSize)}
          disabled={isLastPage}
          className="h-8 px-3"
        >
          {t("common_next")}
        </Button>
      </div>
    </div>
  );
};

/**
 * Wrapper that provides t via useTranslation() — used in normal React tree.
 */
const PaginationWithT: React.FC<PaginationProps> = (props) => {
  const { t } = useTranslation();
  return <PaginationInner {...props} t={t} />;
};

/**
 * Public API — decides how to provide the t function.
 * When a t prop is passed (e.g. from parent inside ModalManager), use it directly.
 * Otherwise, call useTranslation() in a proper component context.
 */
export const Pagination: React.FC<PaginationProps> = (props) => {
  if (props.t) {
    return <PaginationInner {...props} t={props.t} />;
  }
  return <PaginationWithT {...props} />;
};
