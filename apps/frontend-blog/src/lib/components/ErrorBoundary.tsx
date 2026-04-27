'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/navigation';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * 全局错误边界组件
 * 用于捕获组件树中的JavaScript错误，防止整个应用崩溃
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    // 更新state使下一次渲染显示降级UI
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // 记录错误信息
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    // 更新state以包含错误信息
    this.setState({
      error,
      errorInfo,
    });

    // 调用自定义错误处理函数
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // 可以在这里将错误发送到错误监控服务
    // this.reportErrorToService(error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // 如果有自定义降级UI，则使用自定义UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // 否则使用默认降级UI
      return (
        <DefaultErrorFallback
          error={this.state.error}
          onRetryAction={this.handleRetry}
        />
      );
    }

    return this.props.children;
  }
}

/**
 * 默认错误降级UI
 */
interface ErrorFallbackProps {
  error: Error | null;
  onRetryAction: () => void;
}

export function DefaultErrorFallback({
  error,
  onRetryAction,
}: ErrorFallbackProps) {
  const t = useTranslations();

  return (
    <div className="min-h-[400px] flex flex-col items-center justify-center p-8 text-center">
      <div className="mb-6">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-50 dark:bg-red-900/20 mb-4">
          <AlertTriangle className="w-8 h-8 text-red-500" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
          {t('errorBoundary.title')}
        </h2>
        <p className="text-slate-600 dark:text-slate-400 mb-6 max-w-md">
          {t('errorBoundary.description')}
        </p>
      </div>

      {/* 错误详情（仅在开发环境显示） */}
      {process.env.NODE_ENV === 'development' && error && (
        <div className="mb-6 p-4 bg-slate-50 dark:bg-slate-800 rounded-lg text-left w-full max-w-md">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            {t('errorBoundary.errorDetails')}
          </p>
          <pre className="text-xs text-red-600 dark:text-red-400 overflow-auto">
            {error.toString()}
          </pre>
          {error.stack && (
            <pre className="text-xs text-slate-500 dark:text-slate-400 mt-2 overflow-auto">
              {error.stack}
            </pre>
          )}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={onRetryAction}
          className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary-600 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          <span>{t('errorBoundary.retry')}</span>
        </button>

        <Link
          href="/"
          className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          <Home className="w-4 h-4" />
          <span>{t('common.backToHome')}</span>
        </Link>
      </div>

      {/* 技术支持信息 */}
      <div className="mt-8 text-sm text-slate-500 dark:text-slate-400">
        <p>{t('errorBoundary.contactSupport')}</p>
      </div>
    </div>
  );
}

/**
 * 简化的错误边界Hook
 */
export function useErrorBoundary() {
  const [hasError, setHasError] = React.useState(false);
  const [error, setError] = React.useState<Error | null>(null);

  const handleError = React.useCallback((error: Error) => {
    console.error('useErrorBoundary caught an error:', error);
    setHasError(true);
    setError(error);
  }, []);

  const resetError = React.useCallback(() => {
    setHasError(false);
    setError(null);
  }, []);

  return {
    hasError,
    error,
    handleError,
    resetError,
  };
}

/**
 * 页面级错误边界包装器
 */
export function PageErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={
        <div className="max-w-5xl mx-auto px-4 py-20">
          <DefaultErrorFallback
            error={null}
            onRetryAction={() => window.location.reload()}
          />
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}

/**
 * 组件级错误边界包装器
 */
export function ComponentErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={
        <div className="p-4 border border-red-200 dark:border-red-800 rounded-lg bg-red-50 dark:bg-red-900/20">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400 mb-2">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm font-medium">
              组件加载失败，请刷新页面重试
            </span>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="text-xs text-red-500 hover:text-red-600 underline"
          >
            刷新页面
          </button>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}

export default ErrorBoundary;
