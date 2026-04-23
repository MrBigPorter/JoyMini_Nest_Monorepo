'use client';

import React from 'react';
import { useRequest } from 'ahooks';
import { Card, Badge, Button } from '@/components/UIComponents';
import { blogApi } from '@/api';
import { RefreshCw, FileText, List, BarChart3, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useLanguage } from '@/hooks/LanguageProvider';
import { BLOG_TRANSLATION_CARD_TRANSLATIONS } from '@/constants';

// 进度条组件
const ProgressBar = ({ value, max = 100 }: { value: number; max?: number }) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="w-full bg-gray-200 rounded-full h-2">
      <div
        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
};

// 小型统计卡片
const MiniStatCard = ({
  title,
  value,
  total,
  icon: Icon,
  color = 'blue',
}: {
  title: string;
  value: number;
  total: number;
  icon: React.ElementType;
  color?: 'blue' | 'green' | 'purple';
}) => {
  const percentage = total > 0 ? Math.round((value / total) * 100) : 0;

  const colorClasses = {
    blue: { bg: 'bg-blue-50', text: 'text-blue-700', icon: 'text-blue-500' },
    green: {
      bg: 'bg-emerald-50',
      text: 'text-emerald-700',
      icon: 'text-emerald-500',
    },
    purple: {
      bg: 'bg-purple-50',
      text: 'text-purple-700',
      icon: 'text-purple-500',
    },
  };

  const config = colorClasses[color];

  return (
    <div className={`p-3 rounded-lg ${config.bg}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${config.icon}`} />
          <span className={`text-sm font-medium ${config.text}`}>{title}</span>
        </div>
        <span className="text-xs font-medium text-gray-600">{percentage}%</span>
      </div>
      <div className="text-lg font-bold mb-1">
        <span className={config.text}>{value}</span>
        <span className="text-gray-400 text-sm"> / {total}</span>
      </div>
      <ProgressBar value={value} max={total} />
    </div>
  );
};

export default function TranslationProgressCard() {
  const { locale } = useLanguage();

  // 翻译函数
  const t = (key: string, params?: Record<string, string | number>) => {
    const safeLocale = locale === 'zh' || locale === 'en' ? locale : 'en';
    let text = BLOG_TRANSLATION_CARD_TRANSLATIONS[safeLocale][key] || key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, String(v));
      });
    }
    return text;
  };

  const {
    data: progress,
    loading,
    error,
    refresh,
  } = useRequest(() => blogApi.translation.getTranslationProgress(), {
    pollingInterval: 10000, // 每10秒刷新一次
    loadingDelay: 300,
  });

  if (loading) {
    return (
      <Card title={t('translationProgress')} className="animate-pulse">
        <div className="space-y-3">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          <div className="h-2 bg-gray-200 rounded"></div>
          <div className="grid grid-cols-3 gap-2">
            <div className="h-16 bg-gray-200 rounded"></div>
            <div className="h-16 bg-gray-200 rounded"></div>
            <div className="h-16 bg-gray-200 rounded"></div>
          </div>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card title={t('translationProgress')}>
        <div className="text-center py-4">
          <p className="text-sm text-gray-500 mb-2">{t('loadFailed')}</p>
          <Button variant="outline" size="sm" onClick={() => refresh()}>
            <RefreshCw className="w-3 h-3 mr-1" />
            {t('retry')}
          </Button>
        </div>
      </Card>
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
  };

  const overallPercentage =
    progressData.totalItems > 0
      ? Math.round(
          (progressData.completedItems / progressData.totalItems) * 100,
        )
      : 0;

  const hasActiveJobs =
    progressData.queueStatus.active > 0 || progressData.queueStatus.waiting > 0;
  const hasFailedJobs = progressData.queueStatus.failed > 0;

  return (
    <Card
      title={t('translationProgress')}
      action={
        <Link href="/blog/translation-progress">
          <Button variant="ghost" size="sm">
            {t('viewDetails')}
            <ArrowRight className="w-3 h-3 ml-1" />
          </Button>
        </Link>
      }
    >
      <div className="space-y-4">
        {/* 总体进度 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="text-2xl font-bold text-gray-900">
                {overallPercentage}%
              </span>
              <span className="text-sm text-gray-500 ml-2">
                {progressData.completedItems} / {progressData.totalItems}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {hasActiveJobs && <Badge color="yellow">{t('inProgress')}</Badge>}
              {hasFailedJobs && (
                <Badge color="red">
                  {progressData.queueStatus.failed} {t('failed')}
                </Badge>
              )}
              {overallPercentage === 100 && progressData.totalItems > 0 && (
                <Badge color="green">{t('completed')}</Badge>
              )}
            </div>
          </div>
          <ProgressBar
            value={progressData.completedItems}
            max={progressData.totalItems}
          />
        </div>

        {/* 分类统计 */}
        <div className="grid grid-cols-3 gap-2">
          <MiniStatCard
            title={t('articles')}
            value={progressData.articles.completed}
            total={progressData.articles.total}
            icon={FileText}
            color="blue"
          />
          <MiniStatCard
            title={t('categories')}
            value={progressData.categories.completed}
            total={progressData.categories.total}
            icon={List}
            color="green"
          />
          <MiniStatCard
            title={t('tags')}
            value={progressData.tags.completed}
            total={progressData.tags.total}
            icon={BarChart3}
            color="purple"
          />
        </div>

        {/* 队列状态 */}
        <div className="border-t pt-3">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                <span className="text-gray-600">
                  {t('activeJobs', { count: progressData.queueStatus.active })}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                <span className="text-gray-600">
                  {t('waitingJobs', {
                    count: progressData.queueStatus.waiting,
                  })}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
              <span className="text-gray-600">
                {t('completedJobs', {
                  count: progressData.queueStatus.completed,
                })}
              </span>
            </div>
          </div>
        </div>

        {/* 状态提示 */}
        {hasFailedJobs && (
          <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
            {t('failedJobsWarning', { count: progressData.queueStatus.failed })}
          </div>
        )}

        {overallPercentage === 100 && progressData.totalItems > 0 && (
          <div className="text-xs text-emerald-600 bg-emerald-50 p-2 rounded">
            {t('allJobsCompleted')}
          </div>
        )}

        {overallPercentage === 0 && progressData.totalItems > 0 && (
          <div className="text-xs text-amber-600 bg-amber-50 p-2 rounded">
            {t('translationNotStarted')}
          </div>
        )}
      </div>
    </Card>
  );
}
