"use client";

import React, { useState } from "react";
import { useRequest } from "ahooks";
import { Card, Badge, Button, Select } from "@/components/UIComponents";
import { useToastStore } from "@/store/useToastStore";
import { blogApi } from "@/api";
import { useTranslation } from "@/hooks/useTranslation";
import { Search, CheckCircle, Wrench, Languages } from "lucide-react";

const Skeleton = ({ className = "" }: { className?: string }) => (
  <div
    className={`animate-pulse bg-gray-200 dark:bg-white/10 rounded ${className}`}
  />
);

const Checkbox = ({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) => (
  <label className="inline-flex items-center cursor-pointer">
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className="sr-only"
    />
    <div
      className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
        checked
          ? "bg-primary-500 border-primary-500"
          : "border-gray-300 dark:border-white/20"
      }`}
    >
      {checked && (
        <svg
          className="w-3 h-3 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={3}
            d="M5 13l4 4L19 7"
          />
        </svg>
      )}
    </div>
  </label>
);

export default function BlogTranslationIssues() {
  const { t: globalT } = useTranslation();
  const { addToast } = useToastStore();

  const t = (key: string, params?: Record<string, string | number>) =>
    globalT(`blog_translation_${key}`, params);

  const [selectedLanguage, setSelectedLanguage] = useState<string>("en");
  const [selectedArticles, setSelectedArticles] = useState<string[]>([]);
  const [fixingInProgress, setFixingInProgress] = useState(false);

  // 问题检测
  const {
    data: translationIssues,
    loading: issuesLoading,
    run: runIssues,
  } = useRequest(
    () => blogApi.translation.getTranslationIssues(selectedLanguage),
    {
      manual: true,
    },
  );

  // 初始加载
  React.useEffect(() => {
    runIssues();
  }, [runIssues]);

  // 语言变化时重新检测
  React.useEffect(() => {
    runIssues();
  }, [selectedLanguage, runIssues]);

  // 处理批量修复
  const handleBatchFix = async () => {
    if (fixingInProgress) return;

    setFixingInProgress(true);
    try {
      const articleIds =
        selectedArticles.length > 0
          ? selectedArticles
          : translationIssues?.issues?.map((issue: any) => issue.articleId) ||
            [];

      const response = await blogApi.translation.fixTranslationIssuesBatch({
        articleIds: articleIds.length > 0 ? articleIds : undefined,
        languageCode: selectedLanguage,
      });

      if (response.success) {
        addToast("success", t("batchFixStarted", { count: response.queued }));
        setTimeout(() => {
          runIssues();
        }, 1000);
      } else {
        addToast("error", t("batchFixFailed"));
      }
    } catch (error) {
      console.error(t("batchFixFailed"), error);
      addToast("error", t("batchFixNetworkError"));
    } finally {
      setFixingInProgress(false);
    }
  };

  // 处理文章选择
  const handleArticleSelect = (articleId: string) => {
    setSelectedArticles((prev) =>
      prev.includes(articleId)
        ? prev.filter((id) => id !== articleId)
        : [...prev, articleId],
    );
  };

  // 处理全选/取消全选
  const handleSelectAll = () => {
    if (!translationIssues?.issues) return;

    if (selectedArticles.length === translationIssues.issues.length) {
      setSelectedArticles([]);
    } else {
      setSelectedArticles(
        translationIssues.issues.map((issue: any) => issue.articleId),
      );
    }
  };

  return (
    <div className="space-y-6">
      <Card title={t("issuesDetectionTitle")}>
        <div className="space-y-4">
          {/* 语言选择和批量操作控制 */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Languages className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-medium">
                  {t("targetLanguage")}:
                </span>
                <Select
                  value={selectedLanguage}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                    setSelectedLanguage(e.target.value)
                  }
                  options={[
                    { value: "en", label: "英语 (en)" },
                    { value: "ja", label: "日语 (ja)" },
                    { value: "ko", label: "韩语 (ko)" },
                    { value: "fr", label: "法语 (fr)" },
                    { value: "de", label: "德语 (de)" },
                  ]}
                  className="w-40"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => runIssues()}
                isLoading={issuesLoading}
              >
                <Search className="w-4 h-4 mr-2" />
                {t("recheck")}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectAll}
                disabled={!translationIssues?.issues?.length}
              >
                {selectedArticles.length === translationIssues?.issues?.length
                  ? t("deselectAll")
                  : t("selectAll")}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleBatchFix}
                isLoading={fixingInProgress}
                disabled={!translationIssues?.issues?.length}
              >
                <Wrench className="w-4 h-4 mr-2" />
                {selectedArticles.length > 0
                  ? t("fixSelected", { count: selectedArticles.length })
                  : t("fixAll")}
              </Button>
            </div>
          </div>

          {/* 问题文章列表 */}
          {issuesLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : translationIssues?.issues?.length > 0 ? (
            <div className="space-y-3">
              <div className="text-sm text-gray-500 mb-2">
                {t("issuesFound", {
                  count: translationIssues.problematicArticles,
                })}
              </div>
              <div className="rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-white/5">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300 w-12">
                        <Checkbox
                          checked={
                            translationIssues.issues.length > 0 &&
                            selectedArticles.length ===
                              translationIssues.issues.length
                          }
                          onChange={handleSelectAll}
                        />
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                        {t("articleTitle")}
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                        {t("issueType")}
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                        {t("severity")}
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                        {t("actions")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-white/10">
                    {translationIssues.issues.map((issue: any) => (
                      <tr
                        key={issue.articleId}
                        className="hover:bg-gray-50 dark:hover:bg-white/5"
                      >
                        <td className="px-4 py-3">
                          <Checkbox
                            checked={selectedArticles.includes(issue.articleId)}
                            onChange={() =>
                              handleArticleSelect(issue.articleId)
                            }
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900 dark:text-white">
                            {issue.articleTitle}
                          </div>
                          <div className="text-xs text-gray-500">
                            ID: {issue.articleId}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            {issue.issues.map((item: any, idx: number) => (
                              <div key={idx} className="text-sm">
                                <Badge
                                  color={
                                    item.issueType === "TITLE_NOT_TRANSLATED"
                                      ? "red"
                                      : item.issueType === "CONTENT_INCOMPLETE"
                                        ? "yellow"
                                        : "gray"
                                  }
                                >
                                  {item.issueType === "TITLE_NOT_TRANSLATED"
                                    ? t("issueTitleNotTranslated")
                                    : item.issueType === "CONTENT_INCOMPLETE"
                                      ? t("issueContentIncomplete")
                                      : item.issueType === "NOT_TRANSLATED"
                                        ? t("issueNotTranslated")
                                        : t("issueFailed")}
                                </Badge>
                                <div className="text-xs text-gray-500 mt-1">
                                  {item.description}
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            {issue.issues.map((item: any, idx: number) => (
                              <div key={idx}>
                                <Badge
                                  color={
                                    item.severity === "HIGH"
                                      ? "red"
                                      : item.severity === "MEDIUM"
                                        ? "yellow"
                                        : "gray"
                                  }
                                >
                                  {item.severity === "HIGH"
                                    ? t("severityHigh")
                                    : item.severity === "MEDIUM"
                                      ? t("severityMedium")
                                      : t("severityLow")}
                                </Badge>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedArticles([issue.articleId]);
                              handleBatchFix();
                            }}
                          >
                            {t("fixSingle")}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <CheckCircle className="w-12 h-12 mx-auto text-emerald-300 mb-3" />
              <p>{t("noIssuesFound")}</p>
              <p className="text-sm mt-1">
                {t("noIssuesFoundDesc", {
                  lang: selectedLanguage.toUpperCase(),
                })}
              </p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
