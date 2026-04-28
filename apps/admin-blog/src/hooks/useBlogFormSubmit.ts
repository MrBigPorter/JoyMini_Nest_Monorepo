"use client";

import { useCallback } from "react";
import { z } from "zod";
import { useToastStore } from "@/store/useToastStore";

type UseBlogFormSubmitOptions<T extends z.ZodSchema> = {
  onSubmitAction: (data: z.infer<T>) => Promise<void> | void;
};

/**
 * Next.js 15 RC 正确写法: 只封装提交逻辑，永远不要包含useForm
 * useForm() 必须直接在组件内部调用，永远不要作为返回值跨边界
 * 这样就永远不会触发 TS71007 警告
 */
export function useBlogFormSubmit<T extends z.ZodSchema>({
  onSubmitAction,
}: UseBlogFormSubmitOptions<T>) {
  const addToast = useToastStore((state) => state.addToast);

  const handleSubmit = useCallback(
    async (data: z.infer<T>) => {
      try {
        await onSubmitAction(data);
      } catch (error: unknown) {
        let message = "提交失败";

        if (error && typeof error === "object") {
          // 处理 Axios 错误格式
          if (
            "response" in error &&
            error.response &&
            typeof error.response === "object"
          ) {
            if (
              "data" in error.response &&
              error.response.data &&
              typeof error.response.data === "object"
            ) {
              if (
                "message" in error.response.data &&
                typeof error.response.data.message === "string"
              ) {
                message = error.response.data.message;
              }
            }
          }
          // 处理普通 Error 对象
          else if ("message" in error && typeof error.message === "string") {
            message = error.message;
          }
        }
        addToast("error", message);
        console.error("Form submission error:", error);
      }
    },
    [onSubmitAction, addToast],
  );

  return {
    handleSubmit,
  };
}

export default useBlogFormSubmit;
