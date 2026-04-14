'use client';

import React, { useState } from 'react';
import { useRequest } from 'ahooks';
import { Card, Badge, Button, Select } from '@/components/UIComponents';
import { blogApi } from '@/api';
import {
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Clock,
  XCircle,
  BarChart3,
  List,
  FileText,
  Wrench,
  Search,
  Languages,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

// 简单的 Alert 组件
const Alert = ({
  variant = 'default',
  title,
  description,
  action,
}: {
  variant?: 'default' | 'error' | 'warning' | 'success';
  title: string;
  description: string;
  action?: React.ReactNode;
}) => {
  const variantClasses = {
    default: 'bg-gray-50 border-gray-200 text-gray-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    warning: 'bg-amber-50 border-amber-200 text-amber-800',
    success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
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
const Skeleton = ({ className = '' }: { className?: string }) => {
  return (
    <div className={`animate-pulse bg-gray-200 rounded ${className}`}></div>
  );
};

// 简单的 Checkbox 组件
const Checkbox = ({
  checked,
  onChange,
  className = '',
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
          ? 'bg-blue-600 border-blue-600'
          : 'bg-white border-gray-300 hover:border-gray-400'
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
  className = '',
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
  status = 'default',
  icon: Icon,
  className = '',
}: {
  title: string;
  value: number;
  total: number;
  status?: 'default' | 'success' | 'warning' | 'error' | 'info';
  icon: React.ElementType;
  className?: string;
}) => {
  const percentage = total > 0 ? Math.round((value / total) * 100) : 0;

  const statusConfig = {
    default: {
      bg: 'bg-gray-100',
      text: 'text-gray-700',
      iconColor: 'text-gray-500',
    },
    success: {
      bg: 'bg-emerald-50',
      text: 'text-emerald-700',
      iconColor: 'text-emerald-500',
    },
    warning: {
      bg: 'bg-amber-50',
      text: 'text-amber-700',
      iconColor: 'text-amber-500',
    },
    error: { bg: 'bg-red-50', text: 'text-red-700', iconColor: 'text-red-500' },
    info: {
      bg: 'bg-blue-50',
      text: 'text-blue-700',
      iconColor: 'text-blue-500',
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
            status === 'success'
              ? 'green'
              : status === 'warning'
                ? 'yellow'
                : status === 'error'
                  ? 'red'
                  : 'gray'
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
const QueueStatus = ({ status }: { status: any }) => {
  return (
    <Card title="队列状态" className="col-span-2">
      <div className="grid grid-cols-4 gap-4">
        <div className="text-center">
          <div className="text-2xl font-bold text-blue-600">
            {status.active}
          </div>
          <div className="text-sm text-gray-500">进行中</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-amber-600">
            {status.waiting}
          </div>
          <div className="text-sm text-gray-500">等待中</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-red-600">{status.failed}</div>
          <div className="text-sm text-gray-500">失败</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-emerald-600">
            {status.completed}
          </div>
          <div className="text-sm text-gray-500">已完成</div>
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
}: {
  startTime: string | null;
  estimatedCompletionTime: string | null;
  elapsedTime: number;
}) => {
  return (
    <Card title="时间信息" className="col-span-2">
      <div className="space-y-3">
        <div className="flex justify-between">
          <span className="text-gray-600">开始时间:</span>
          <span className="font-medium">
            {startTime
              ? format(new Date(startTime), 'yyyy-MM-dd HH:mm:ss')
              : '未开始'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">已运行:</span>
          <span className="font-medium">
            {elapsedTime > 0
              ? formatDistanceToNow(new Date(Date.now() - elapsedTime * 1000), {
                  locale: zhCN,
                })
              : '0秒'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">预计完成:</span>
          <span className="font-medium">
            {estimatedCompletionTime
              ? formatDistanceToNow(new Date(estimatedCompletionTime), {
                  locale: zhCN,
                  addSuffix: true,
                })
              : '未知'}
          </span>
        </div>
      </div>
    </Card>
  );
};

export default function BlogTranslationProgress() {
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('en');
  const [selectedArticles, setSelectedArticles] = useState<string[]>([]);
  const [fixingInProgress, setFixingInProgress] = useState(false);

  const {
    data: progress,
    loading,
    error,
    refresh,
    run: runProgress,
  } = useRequest(() => blogApi.translation.getTranslationProgress(), {
    manual: true,
    pollingInterval: autoRefresh ? 5000 : undefined,
    loadingDelay: 300,
    refreshOnWindowFocus: true,
  });

  const {
    data: jobs,
    loading: jobsLoading,
    run: runJobs,
  } = useRequest(() => blogApi.translation.getTranslationJobs(), {
    manual: true,
    pollingInterval: autoRefresh ? 5000 : undefined,
  });

  // 问题检测相关
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
    runIssues();
  }, [runProgress, runJobs, runIssues]);

  // autoRefresh 变化时重新配置轮询
  React.useEffect(() => {
    if (autoRefresh) {
      // 手动触发一次刷新
      refresh();
    }
  }, [autoRefresh, refresh]);

  // 语言变化时重新检测问题
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
        alert(`已成功投递 ${response.queued} 个修复任务`);
        // 刷新数据
        setTimeout(() => {
          runProgress();
          runJobs();
          runIssues();
        }, 1000);
      } else {
        alert('批量修复失败，请稍后重试');
      }
    } catch (error) {
      console.error('批量修复失败:', error);
      alert('批量修复失败，请检查网络连接');
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

  if (error) {
    return (
      <div className="p-6">
        <Alert
          variant="error"
          title="加载失败"
          description={error.message || '无法获取翻译进度数据'}
          action={
            <Button variant="outline" onClick={() => refresh()}>
              <RefreshCw className="w-4 h-4 mr-2" />
              重试
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
          <h1 className="text-2xl font-bold text-gray-900">翻译进度监控</h1>
          <p className="text-gray-500 mt-1">实时监控博客内容翻译进度和状态</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant={autoRefresh ? 'primary' : 'outline'}
            onClick={() => setAutoRefresh(!autoRefresh)}
            size="sm"
          >
            <RefreshCw
              className={`w-4 h-4 mr-2 ${autoRefresh ? 'animate-spin' : ''}`}
            />
            {autoRefresh ? '自动刷新中' : '开启自动刷新'}
          </Button>
          <Button variant="outline" onClick={() => refresh()} size="sm">
            <RefreshCw className="w-4 h-4 mr-2" />
            手动刷新
          </Button>
        </div>
      </div>

      {/* 总体进度 */}
      <Card title="总体进度" className="col-span-3">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-3xl font-bold text-gray-900">
                {overallPercentage}%
              </div>
              <div className="text-gray-500">
                已完成 {progressData.completedItems} / {progressData.totalItems}{' '}
                个项目
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-500" />
                <span className="text-gray-700">
                  {progressData.completedItems} 完成
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-amber-500" />
                <span className="text-gray-700">
                  {progressData.inProgressItems} 进行中
                </span>
              </div>
              <div className="flex items-center gap-2">
                <XCircle className="w-5 h-5 text-red-500" />
                <span className="text-gray-700">
                  {progressData.failedItems} 失败
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
          title="文章翻译"
          value={progressData.articles.completed}
          total={progressData.articles.total}
          status={
            progressData.articles.completed === progressData.articles.total
              ? 'success'
              : 'info'
          }
          icon={FileText}
        />
        <StatCard
          title="分类翻译"
          value={progressData.categories.completed}
          total={progressData.categories.total}
          status={
            progressData.categories.completed === progressData.categories.total
              ? 'success'
              : 'info'
          }
          icon={List}
        />
        <StatCard
          title="标签翻译"
          value={progressData.tags.completed}
          total={progressData.tags.total}
          status={
            progressData.tags.completed === progressData.tags.total
              ? 'success'
              : 'info'
          }
          icon={BarChart3}
        />
      </div>

      {/* 队列状态和时间信息 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <QueueStatus status={progressData.queueStatus} />
        <TimeInfo
          startTime={progressData.startTime}
          estimatedCompletionTime={progressData.estimatedCompletionTime}
          elapsedTime={progressData.elapsedTime}
        />
      </div>

      {/* 问题文章检测 */}
      <Card title="🔍 问题文章检测">
        <div className="space-y-4">
          {/* 语言选择和批量操作控制 */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Languages className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-medium">目标语言:</span>
                <Select
                  value={selectedLanguage}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                    setSelectedLanguage(e.target.value)
                  }
                  options={[
                    { value: 'en', label: '英语 (en)' },
                    { value: 'ja', label: '日语 (ja)' },
                    { value: 'ko', label: '韩语 (ko)' },
                    { value: 'fr', label: '法语 (fr)' },
                    { value: 'de', label: '德语 (de)' },
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
                重新检测
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
                  ? '取消全选'
                  : '全选'}
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
                  ? `修复选中 (${selectedArticles.length})`
                  : '修复所有问题'}
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
                发现 {translationIssues.problematicArticles} 篇文章有翻译问题
              </div>
              <div className="border  rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 w-12">
                        <Checkbox
                          checked={
                            translationIssues.issues.length > 0 &&
                            selectedArticles.length ===
                              translationIssues.issues.length
                          }
                          onChange={handleSelectAll}
                        />
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                        文章标题
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                        问题类型
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                        严重程度
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {translationIssues.issues.map((issue: any) => (
                      <tr key={issue.articleId}>
                        <td className="px-4 py-3">
                          <Checkbox
                            checked={selectedArticles.includes(issue.articleId)}
                            onChange={() =>
                              handleArticleSelect(issue.articleId)
                            }
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium">
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
                                    item.issueType === 'TITLE_NOT_TRANSLATED'
                                      ? 'red'
                                      : item.issueType === 'CONTENT_INCOMPLETE'
                                        ? 'yellow'
                                        : 'gray'
                                  }
                                >
                                  {item.issueType === 'TITLE_NOT_TRANSLATED'
                                    ? '标题未翻译'
                                    : item.issueType === 'CONTENT_INCOMPLETE'
                                      ? '内容不完整'
                                      : item.issueType === 'NOT_TRANSLATED'
                                        ? '未翻译'
                                        : '翻译失败'}
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
                                    item.severity === 'HIGH'
                                      ? 'red'
                                      : item.severity === 'MEDIUM'
                                        ? 'yellow'
                                        : 'gray'
                                  }
                                >
                                  {item.severity === 'HIGH'
                                    ? '高'
                                    : item.severity === 'MEDIUM'
                                      ? '中'
                                      : '低'}
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
                            单独修复
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
              <p>未发现翻译问题</p>
              <p className="text-sm mt-1">
                当前语言 ({selectedLanguage.toUpperCase()}) 的所有文章翻译正常
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* 任务列表 */}
      <Card title="实时任务列表">
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
                  进行中的任务 ({jobs.active.length})
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
                        进度: {job.progress || 0}%
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
                  等待中的任务 ({jobs.waiting.length})
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
                      <div className="text-sm text-gray-500">等待中...</div>
                    </div>
                  ))}
                  {jobs.waiting.length > 5 && (
                    <div className="text-center text-sm text-gray-500 py-2">
                      还有 {jobs.waiting.length - 5} 个任务在等待中
                    </div>
                  )}
                </div>
              </div>
            )}

            {jobs.failed.length > 0 && (
              <div>
                <h3 className="font-medium text-gray-700 mb-2 flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-red-500" />
                  失败的任务 ({jobs.failed.length})
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
                          {job.failedReason || '未知错误'}
                        </div>
                      </div>
                      <Button variant="outline" size="sm">
                        重试
                      </Button>
                    </div>
                  ))}
                  {jobs.failed.length > 3 && (
                    <div className="text-center text-sm text-gray-500 py-2">
                      还有 {jobs.failed.length - 3} 个失败任务
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <AlertCircle className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p>当前没有活跃的翻译任务</p>
          </div>
        )}
      </Card>

      {/* 状态提示 */}
      {progressData.failedItems > 0 && (
        <Alert
          variant="error"
          title="存在失败任务"
          description={`有 ${progressData.failedItems} 个翻译任务失败，请检查失败任务列表。`}
        />
      )}

      {progressData.inProgressItems === 0 &&
        progressData.completedItems < progressData.totalItems && (
          <Alert
            variant="warning"
            title="翻译未开始"
            description="所有翻译任务都在等待中，请检查队列状态。"
          />
        )}

      {progressData.completedItems === progressData.totalItems &&
        progressData.totalItems > 0 && (
          <Alert
            variant="success"
            title="翻译完成"
            description="所有翻译任务已完成！"
          />
        )}
    </div>
  );
}
