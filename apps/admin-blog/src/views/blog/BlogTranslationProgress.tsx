"use client";

import React, { useState } from "react";
import { useRequest } from "ahooks";
import { Card, Badge, Button, Select } from "@/components/UIComponents";
import { useToastStore } from "@/store/useToastStore";
import { blogApi } from "@/api";
import { useTranslation } from "@/hooks/useTranslation";
import { enUS, zhCN } from "date-fns/locale";
import {
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Clock,
  XCircle,
  BarChart3,
  List,
  FileText,
  Languages,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { ModalManager } from "@repo/ui";
import LocalizedText from "@/components/blog/LocalizedText.tsx";
import { renderLocalizedText } from "@/utils/localizedText.ts";

// 简单的 Alert 组件
const Alert = ({
  variant = "default",
  title,
  description,
  action,
}: {
  variant?: "default" | "error" | "warning" | "success";
  title: string;
  description: string;
  action?: React.ReactNode;
}) => {
  const variantClasses = {
    default: "bg-gray-50 border-gray-200 text-gray-800",
    error: "bg-red-50 border-red-200 text-red-800",
    warning: "bg-amber-50 border-amber-200 text-amber-800",
    success: "bg-emerald-50 border-emerald-200 text-emerald-800",
  };

  return (
    <div className={`border rounded-lg p-4 ${variantClasses[variant]}`}>
      <div className="flex items-start">
        <div className="flex-1">
          <h3 className="font-medium">{title}</h3>
          <p className="text-sm mt-1">{description}</p>
        </div>
        {action && <div className="ml-4">{action}</div>}
      </div>
    </div>
  );
};

// 简单的 Skeleton 组件
const Skeleton = ({ className = "" }: { className?: string }) => {
  return (
    <div className={`animate-pulse bg-gray-200 rounded ${className}`}></div>
  );
};

// 简单的 Checkbox 组件
const Checkbox = ({
  checked,
  onChange,
  className = "",
}: {
  checked: boolean;
  onChange: () => void;
  className?: string;
}) => {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
        checked
          ? "bg-blue-600 border-blue-600"
          : "bg-white border-gray-300 hover:border-gray-400"
      } ${className}`}
    >
      {checked && (
        <svg
          className="w-3 h-3 text-white"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="3"
            d="M5 13l4 4L19 7"
          />
        </svg>
      )}
    </button>
  );
};

// 进度条组件
const ProgressBar = ({
  value,
  max = 100,
  className = "",
}: {
  value: number;
  max?: number;
  className?: string;
}) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div className={`w-full bg-gray-200 rounded-full h-4 ${className}`}>
      <div
        className="bg-blue-600 h-4 rounded-full transition-all duration-500 ease-out"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
};

// 统计卡片组件
const StatCard = ({
  title,
  value,
  total,
  status = "default",
  icon: Icon,
  className = "",
}: {
  title: string;
  value: number;
  total: number;
  status?: "default" | "success" | "warning" | "error" | "info";
  icon: React.ElementType;
  className?: string;
}) => {
  const percentage = total > 0 ? Math.round((value / total) * 100) : 0;

  const statusConfig = {
    default: {
      bg: "bg-gray-100",
      text: "text-gray-700",
      iconColor: "text-gray-500",
    },
    success: {
      bg: "bg-emerald-50",
      text: "text-emerald-700",
      iconColor: "text-emerald-500",
    },
    warning: {
      bg: "bg-amber-50",
      text: "text-amber-700",
      iconColor: "text-amber-500",
    },
    error: { bg: "bg-red-50", text: "text-red-700", iconColor: "text-red-500" },
    info: {
      bg: "bg-blue-50",
      text: "text-blue-700",
      iconColor: "text-blue-500",
    },
  };

  const config = statusConfig[status];

  return (
    <Card className={`p-4 ${config.bg} ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className={`w-5 h-5 ${config.iconColor}`} />
          <span className={`font-medium ${config.text}`}>{title}</span>
        </div>
        <Badge
          color={
            status === "success"
              ? "green"
              : status === "warning"
                ? "yellow"
                : status === "error"
                  ? "red"
                  : "gray"
          }
        >
          {percentage}%
        </Badge>
      </div>
      <div className="text-2xl font-bold mb-1">
        <span className={config.text}>{value}</span>
        <span className="text-gray-400 text-lg"> / {total}</span>
      </div>
      <ProgressBar value={value} max={total} />
    </Card>
  );
};

// 队列状态组件
const QueueStatus = ({
  status,
  t,
}: {
  status: any;
  t: (key: string) => string;
}) => {
  return (
    <Card title={t("queueStatus")} className="col-span-2">
      <div className="grid grid-cols-4 gap-4">
        <div className="text-center">
          <div className="text-2xl font-bold text-blue-600">
            {status.active}
          </div>
          <div className="text-sm text-gray-500">{t("inProgress")}</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-amber-600">
            {status.waiting}
          </div>
          <div className="text-sm text-gray-500">{t("statusQueued")}</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-red-600">{status.failed}</div>
          <div className="text-sm text-gray-500">{t("failed")}</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-emerald-600">
            {status.completed}
          </div>
          <div className="text-sm text-gray-500">{t("completed")}</div>
        </div>
      </div>
    </Card>
  );
};

// 时间信息组件
const TimeInfo = ({
  startTime,
  estimatedCompletionTime,
  elapsedTime,
  t,
  dateLocale,
}: {
  startTime: string | null;
  estimatedCompletionTime: string | null;
  elapsedTime: number;
  t: (key: string) => string;
  dateLocale: any;
}) => {
  return (
    <Card title={t("timeInfo")} className="col-span-2">
      <div className="space-y-3">
        <div className="flex justify-between">
          <span className="text-gray-600">{t("startTime")}:</span>
          <span className="font-medium">
            {startTime
              ? format(new Date(startTime), "yyyy-MM-dd HH:mm:ss")
              : t("notStarted")}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">{t("elapsedTime")}:</span>
          <span className="font-medium">
            {elapsedTime > 0
              ? formatDistanceToNow(new Date(Date.now() - elapsedTime * 1000), {
                  locale: dateLocale,
                })
              : t("seconds")}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">{t("estimatedCompletion")}:</span>
          <span className="font-medium">
            {estimatedCompletionTime
              ? formatDistanceToNow(new Date(estimatedCompletionTime), {
                  locale: dateLocale,
                  addSuffix: true,
                })
              : t("unknown")}
          </span>
        </div>
      </div>
    </Card>
  );
};

export default function BlogTranslationProgress() {
  const { t: globalT, lang } = useTranslation();
  const { addToast } = useToastStore();

  // Local blog-scoped t that prefixes keys with `blog_translation_` to
  // preserve existing key naming in this view.
  const t = (key: string, params?: Record<string, string | number>) =>
    globalT(`blog_translation_${key}`, params);

  // 动态date-fns本地化
  const dateLocale = (lang === "zh" ? zhCN : enUS) as any;

  const [autoRefresh, setAutoRefresh] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>("en");
  const [showOnlyActive, setShowOnlyActive] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const {
    data: progress,
    loading,
    error,
    refresh,
    run: runProgress,
  } = useRequest(
    () => blogApi.translation.getTranslationProgress(selectedLanguage),
    {
      manual: true,
      pollingInterval: autoRefresh ? 5000 : undefined,
      loadingDelay: 300,
      refreshOnWindowFocus: true,
    },
  );

  const {
    data: jobs,
    loading: jobsLoading,
    run: runJobs,
  } = useRequest(() => blogApi.translation.getTranslationJobs(), {
    manual: true,
    pollingInterval: autoRefresh ? 5000 : undefined,
  });

  const {
    data: dbJobs,
    loading: dbJobsLoading,
    run: runDbJobs,
  } = useRequest(
    () =>
      blogApi.translation.getTranslationJobsDetail(
        selectedLanguage,
        undefined,
        currentPage,
        pageSize,
      ),
    {
      manual: true,
      pollingInterval: autoRefresh ? 5000 : undefined,
    },
  );

  // 待翻译文章
  const {
    data: untranslatedArticles,
    loading: untranslatedLoading,
    run: runUntranslated,
  } = useRequest(
    () => blogApi.translation.getUntranslatedArticles(selectedLanguage),
    {
      manual: true,
      pollingInterval: autoRefresh ? 5000 : undefined,
    },
  );

  // 启用语言列表
  const { data: enabledLanguages, loading: languagesLoading } = useRequest(
    () => blogApi.translation.getEnabledLanguages(),
    {
      manual: false,
    },
  );

  // 初始加载和 autoRefresh 变化时触发请求
  React.useEffect(() => {
    runProgress();
    runJobs();
    runDbJobs();
    runUntranslated();
  }, [runProgress, runJobs, runDbJobs, runUntranslated]);

  // autoRefresh 变化时重新配置轮询
  React.useEffect(() => {
    if (autoRefresh) {
      // 手动触发一次刷新
      refresh();
    }
  }, [autoRefresh, refresh]);

  // 语言变化时重新检测问题并刷新进度
  React.useEffect(() => {
    runProgress();
    runUntranslated();
  }, [selectedLanguage, runProgress, runUntranslated]);

  if (error) {
    return (
      <div className="p-6">
        <Alert
          variant="error"
          title={t("loadFailedTitle")}
          description={error.message || t("loadFailedDesc")}
          action={
            <Button variant="outline" onClick={() => refresh()}>
              <RefreshCw className="w-4 h-4 mr-2" />
              {t("retryButton")}
            </Button>
          }
        />
      </div>
    );
  }

  if (loading && !progress) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const progressData = progress || {
    totalItems: 0,
    completedItems: 0,
    failedItems: 0,
    inProgressItems: 0,
    articles: { total: 0, completed: 0, failed: 0, pending: 0 },
    categories: { total: 0, completed: 0, failed: 0, pending: 0 },
    tags: { total: 0, completed: 0, failed: 0, pending: 0 },
    queueStatus: { active: 0, waiting: 0, failed: 0, completed: 0 },
    startTime: null,
    estimatedCompletionTime: null,
    elapsedTime: 0,
  };

  const overallPercentage =
    progressData.totalItems > 0
      ? Math.round(
          (progressData.completedItems / progressData.totalItems) * 100,
        )
      : 0;

  return (
    <div className="p-6 space-y-6">
      {/* 标题和控制栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-400">{t("pageTitle")}</h1>
          <p className="text-gray-500 mt-1">{t("pageSubtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant={autoRefresh ? "primary" : "outline"}
            onClick={() => setAutoRefresh(!autoRefresh)}
            size="sm"
          >
            <RefreshCw
              className={`w-4 h-4 mr-2 ${autoRefresh ? "animate-spin" : ""}`}
            />
            {autoRefresh ? t("autoRefreshOn") : t("autoRefreshOff")}
          </Button>
          <Button variant="outline" onClick={() => refresh()} size="sm">
            <RefreshCw className="w-4 h-4 mr-2" />
            {t("manualRefresh")}
          </Button>
        </div>
      </div>

      {/* 总体进度 */}
      <Card title={t("overallProgress")} className="col-span-3">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-3xl font-bold text-foreground">
                {overallPercentage}%
              </div>
              <div className="text-gray-500">
                {t("completedItems", {
                  completed: progressData.completedItems,
                  total: progressData.totalItems,
                })}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-500" />
                <span className="text-gray-700">
                  {progressData.completedItems} {t("completed")}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-amber-500" />
                <span className="text-gray-700">
                  {progressData.inProgressItems} {t("inProgress")}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <XCircle className="w-5 h-5 text-red-500" />
                <span className="text-gray-700">
                  {progressData.failedItems} {t("failed")}
                </span>
              </div>
            </div>
          </div>
          <ProgressBar
            value={progressData.completedItems}
            max={progressData.totalItems}
          />
        </div>
      </Card>

      {/* 分类统计 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title={t("articleTranslation")}
          value={progressData.articles.completed}
          total={progressData.articles.total}
          status={
            progressData.articles.completed === progressData.articles.total
              ? "success"
              : "info"
          }
          icon={FileText}
        />
        <StatCard
          title={t("categoryTranslation")}
          value={progressData.categories.completed}
          total={progressData.categories.total}
          status={
            progressData.categories.completed === progressData.categories.total
              ? "success"
              : "info"
          }
          icon={List}
        />
        <StatCard
          title={t("tagTranslation")}
          value={progressData.tags.completed}
          total={progressData.tags.total}
          status={
            progressData.tags.completed === progressData.tags.total
              ? "success"
              : "info"
          }
          icon={BarChart3}
        />
      </div>

      {/* 队列状态和时间信息 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <QueueStatus status={progressData.queueStatus} t={t} />
        <TimeInfo
          startTime={progressData.startTime}
          estimatedCompletionTime={progressData.estimatedCompletionTime}
          elapsedTime={progressData.elapsedTime}
          t={t}
          dateLocale={dateLocale}
        />
      </div>

      {/* 🔍 待翻译文章 */}
      <Card
        title={t("pendingArticlesTitle", {
          lang: selectedLanguage.toUpperCase(),
        })}
      >
        <div className="space-y-4">
          {untranslatedLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : untranslatedArticles && untranslatedArticles.length > 0 ? (
            <div className="space-y-3">
              <div className="text-sm text-gray-500 mb-2">
                {t("pendingArticlesDescription", {
                  count: untranslatedArticles.length,
                  lang: selectedLanguage.toUpperCase(),
                })}
              </div>
              <div className="grid gap-3">
                {untranslatedArticles.map((article: any) => (
                  <div
                    key={article.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex-1">
                      <div className="font-medium">{article.title}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge
                          color={
                            article.status === "COMPLETED"
                              ? "green"
                              : article.status === "PROCESSING"
                                ? "yellow"
                                : article.status === "QUEUED"
                                  ? "blue"
                                  : article.status === "FAILED"
                                    ? "red"
                                    : "gray"
                          }
                        >
                          {article.status === "COMPLETED"
                            ? t("statusCompleted")
                            : article.status === "PROCESSING"
                              ? t("statusProcessing", {
                                  progress: article.progress,
                                })
                              : article.status === "QUEUED"
                                ? t("statusQueued")
                                : article.status === "FAILED"
                                  ? t("statusFailed")
                                  : t("statusUntranslated")}
                        </Badge>
                        {article.status === "PROCESSING" && (
                          <ProgressBar
                            value={article.progress}
                            max={100}
                            className="w-32 h-2"
                          />
                        )}
                      </div>
                    </div>
                    <Button
                      variant={
                        article.status === "PROCESSING" ||
                        article.status === "QUEUED"
                          ? "outline"
                          : "primary"
                      }
                      size="sm"
                      disabled={
                        article.status === "PROCESSING" ||
                        article.status === "QUEUED"
                      }
                      onClick={() => {
                        blogApi.translation.translateArticle(
                          article.id,
                          selectedLanguage,
                        );
                        setTimeout(() => {
                          runUntranslated();
                          runDbJobs();
                        }, 500);
                      }}
                    >
                      {article.status === "PROCESSING" ||
                      article.status === "QUEUED"
                        ? t("statusProcessing", { progress: article.progress })
                        : t("translateButton")}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <CheckCircle className="w-12 h-12 mx-auto text-emerald-300 mb-3" />
              <p>{t("allArticlesTranslated")}</p>
              <p className="text-sm mt-1">
                {t("allArticlesTranslatedDesc", {
                  lang: selectedLanguage.toUpperCase(),
                })}
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* ⚡ 活跃翻译任务 */}
      <Card
        title={t("activeJobsTitle", {
          count:
            dbJobs?.items?.filter(
              (j: any) => j.status === "QUEUED" || j.status === "PROCESSING",
            ).length || 0,
        })}
      >
        <div className="space-y-4">
          {dbJobsLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : (
            (() => {
              const activeJobs =
                dbJobs?.items?.filter(
                  (j: any) =>
                    j.status === "QUEUED" || j.status === "PROCESSING",
                ) || [];

              if (activeJobs.length === 0) {
                return (
                  <div className="text-center py-6 text-gray-500">
                    <Clock className="w-10 h-10 mx-auto text-gray-300 mb-2" />
                    <p>{t("noActiveJobs")}</p>
                  </div>
                );
              }

              return (
                <div className="space-y-2">
                  {activeJobs.map((job: any) => (
                    <div
                      key={job.id}
                      className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg"
                    >
                      <div className="w-32 text-sm">
                        <Badge
                          color={
                            job.type === "article"
                              ? "blue"
                              : job.type === "category"
                                ? "green"
                                : "gray"
                          }
                        >
                          {job.type === "article"
                            ? t("typeArticle")
                            : job.type === "category"
                              ? t("typeCategory")
                              : t("typeTag")}
                        </Badge>
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-sm">
                          {job.targetName} → {job.targetLang.toUpperCase()}
                        </div>
                      </div>
                      <div className="w-40">
                        <div className="flex items-center gap-2">
                          <ProgressBar
                            value={job.progress}
                            max={100}
                            className="flex-1 h-3"
                          />
                          <span className="text-sm text-gray-600 w-10 text-right">
                            {job.progress}%
                          </span>
                        </div>
                      </div>
                      <Badge
                        color={job.status === "PROCESSING" ? "yellow" : "blue"}
                      >
                        {job.status === "PROCESSING"
                          ? t("statusProcessing", { progress: "" }).replace(
                              " %",
                              "",
                            )
                          : t("statusQueued")}
                      </Badge>
                    </div>
                  ))}
                </div>
              );
            })()
          )}
        </div>
      </Card>

      {/* 持久化翻译任务记录 */}
      <Card title={t("jobHistoryTitle")}>
        <div className="space-y-4">
          {/* 控制栏 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{t("filter")}:</span>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showOnlyActive}
                    onChange={(e) => setShowOnlyActive(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">{t("showOnlyActive")}</span>
                </label>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{t("perPage")}:</span>
                <Select
                  value={pageSize.toString()}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                    setPageSize(Number(e.target.value))
                  }
                  options={[
                    { value: "10", label: t("perPageItems", { count: 10 }) },
                    { value: "20", label: t("perPageItems", { count: 20 }) },
                    { value: "50", label: t("perPageItems", { count: 50 }) },
                    { value: "100", label: t("perPageItems", { count: 100 }) },
                  ]}
                  className="w-24"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage <= 1}
              >
                {t("prevPage")}
              </Button>
              <span className="text-sm text-gray-600">
                {t("currentPage", { page: currentPage })}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(currentPage + 1)}
                disabled={
                  dbJobs &&
                  dbJobs.totalPages &&
                  currentPage >= dbJobs.totalPages
                }
              >
                {t("nextPage")}
              </Button>
            </div>
          </div>

          {dbJobsLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : dbJobs && dbJobs.items && dbJobs.items.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                      {t("name")}
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                      {t("type")}
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                      {t("targetLang")}
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                      {t("status")}
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                      {t("progress")}
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                      {t("createdAt")}
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                      {t("errorMsg")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {dbJobs.items.map((job: any) => (
                    <tr key={job.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm">
                        <div className="font-medium">{job.targetName}</div>
                        <div className="text-xs text-gray-500 font-mono">
                          ID: {job.targetId.substring(0, 8)}...
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <Badge
                          color={
                            job.type === "article"
                              ? "blue"
                              : job.type === "category"
                                ? "green"
                                : "gray"
                          }
                        >
                          {job.type === "article"
                            ? t("typeArticle")
                            : job.type === "category"
                              ? t("typeCategory")
                              : t("typeTag")}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm">{job.targetLang}</td>
                      <td className="px-4 py-3 text-sm">
                        <Badge
                          color={
                            job.status === "COMPLETED"
                              ? "green"
                              : job.status === "PROCESSING"
                                ? "yellow"
                                : job.status === "FAILED"
                                  ? "red"
                                  : "gray"
                          }
                        >
                          {job.status === "QUEUED"
                            ? t("statusQueued")
                            : job.status === "PROCESSING"
                              ? t("statusProcessing", { progress: "" }).replace(
                                  " %",
                                  "",
                                )
                              : job.status === "COMPLETED"
                                ? t("statusCompleted")
                                : t("statusFailed")}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex items-center gap-2">
                          <ProgressBar
                            value={job.progress}
                            max={100}
                            className="w-20"
                          />
                          <span className="text-gray-600">{job.progress}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {job.createdAt
                          ? format(new Date(job.createdAt), "MM-dd HH:mm")
                          : "-"}
                      </td>
                      <td className="px-4 py-3 text-sm text-red-600 max-w-[200px] truncate">
                        {job.errorMsg || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between mt-4 pt-4 border-t">
                <div className="text-sm text-gray-500">
                  {t("totalRecords", {
                    total: dbJobs.total,
                    page: dbJobs.page,
                    totalPages: dbJobs.totalPages,
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage <= 1}
                  >
                    {t("prevPage")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(currentPage + 1)}
                    disabled={currentPage >= dbJobs.totalPages}
                  >
                    {t("nextPage")}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <AlertCircle className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <p>{t("noJobRecords")}</p>
            </div>
          )}
        </div>
      </Card>

      {/* 任务列表 */}
      <Card title={t("liveJobsTitle")}>
        {jobsLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : jobs &&
          (jobs.active.length > 0 ||
            jobs.waiting.length > 0 ||
            jobs.failed.length > 0) ? (
          <div className="space-y-4">
            {jobs.active.length > 0 && (
              <div>
                <h3 className="font-medium text-gray-700 mb-2 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-500" />
                  {t("activeJobs", { count: jobs.active.length })}
                </h3>
                <div className="space-y-2">
                  {jobs.active.map((job: any) => (
                    <div
                      key={job.id}
                      className="flex items-center justify-between p-3 bg-amber-50 rounded-lg"
                    >
                      <div>
                        <div className="font-medium">{job.name}</div>
                        <div className="text-sm text-gray-500">
                          {job.data?.articleId ||
                            job.data?.categoryId ||
                            job.data?.tagId}
                        </div>
                      </div>
                      <div className="text-sm text-gray-500">
                        {t("progressWithPercent", {
                          progress: job.progress || 0,
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {jobs.waiting.length > 0 && (
              <div>
                <h3 className="font-medium text-gray-700 mb-2 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-500" />
                  {t("waitingJobs", { count: jobs.waiting.length })}
                </h3>
                <div className="space-y-2">
                  {jobs.waiting.slice(0, 5).map((job: any) => (
                    <div
                      key={job.id}
                      className="flex items-center justify-between p-3 bg-blue-50 rounded-lg"
                    >
                      <div>
                        <div className="font-medium">{job.name}</div>
                        <div className="text-sm text-gray-500">
                          {job.data?.articleId ||
                            job.data?.categoryId ||
                            job.data?.tagId}
                        </div>
                      </div>
                      <div className="text-sm text-gray-500">
                        {t("waiting")}
                      </div>
                    </div>
                  ))}
                  {jobs.waiting.length > 5 && (
                    <div className="text-center text-sm text-gray-500 py-2">
                      {t("moreWaitingJobs", { count: jobs.waiting.length - 5 })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {jobs.failed.length > 0 && (
              <div>
                <h3 className="font-medium text-gray-700 mb-2 flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-red-500" />
                  {t("failedJobs", { count: jobs.failed.length })}
                </h3>
                <div className="space-y-2">
                  {jobs.failed.slice(0, 3).map((job: any) => (
                    <div
                      key={job.id}
                      className="flex items-center justify-between p-3 bg-red-50 rounded-lg"
                    >
                      <div>
                        <div className="font-medium text-red-700">
                          {job.name}
                        </div>
                        <div className="text-sm text-red-600">
                          {job.failedReason || t("unknownError")}
                        </div>
                      </div>
                      <Button variant="outline" size="sm">
                        {t("retry")}
                      </Button>
                    </div>
                  ))}
                  {jobs.failed.length > 3 && (
                    <div className="text-center text-sm text-gray-500 py-2">
                      {t("moreFailedJobs", { count: jobs.failed.length - 3 })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <AlertCircle className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p>{t("noLiveJobs")}</p>
          </div>
        )}
      </Card>

      {/* 状态提示 */}
      {progressData.failedItems > 0 && (
        <Alert
          variant="error"
          title={t("failedJobsAlertTitle")}
          description={t("failedJobsAlertDesc", {
            count: progressData.failedItems,
          })}
        />
      )}

      {progressData.inProgressItems === 0 &&
        progressData.completedItems < progressData.totalItems && (
          <Alert
            variant="warning"
            title={t("notStartedAlertTitle")}
            description={t("notStartedAlertDesc")}
          />
        )}

      {progressData.completedItems === progressData.totalItems &&
        progressData.totalItems > 0 && (
          <Alert
            variant="success"
            title={t("completedAlertTitle")}
            description={t("completedAlertDesc")}
          />
        )}
    </div>
  );
}
