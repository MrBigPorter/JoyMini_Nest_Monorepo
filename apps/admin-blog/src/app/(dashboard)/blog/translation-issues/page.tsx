"use client";

import React from "react";
import { PageHeader } from "@/components/scaffold/PageHeader";
import { useTranslation } from "@/hooks/useTranslation";
import BlogTranslationIssues from "@/views/blog/BlogTranslationIssues";

export default function TranslationIssuesPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("translation_issues")}
        description={t("translation_issues_desc")}
        breadcrumbs={[t("tools"), t("translation_issues")]}
      />
      <BlogTranslationIssues />
    </div>
  );
}
