'use client';

import React from 'react';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { useTranslation } from '@/hooks/useTranslation';
import BlogTranslationQualityDetection from '@/views/blog/BlogTranslationQualityDetection';

export default function TranslationQualityPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('translation_quality')}
        description={t('translation_quality_desc')}
        breadcrumbs={[t('tools'), t('translation_quality')]}
      />
      <BlogTranslationQualityDetection />
    </div>
  );
}
