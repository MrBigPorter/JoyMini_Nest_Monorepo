'use client';

import React from 'react';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { useTranslation } from '@/hooks/useTranslation';
import BlogTranslationQualityDetectionStream from '@/views/blog/BlogTranslationQualityDetectionStream';

export default function TranslationQualityStreamPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('translation_quality_stream')}
        description={t('translation_quality_stream_desc')}
        breadcrumbs={[t('tools'), t('translation_quality_stream')]}
      />
      <BlogTranslationQualityDetectionStream />
    </div>
  );
}
