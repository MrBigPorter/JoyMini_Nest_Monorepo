'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, X, Command } from 'lucide-react';
import { useRouter } from '@/navigation';
import { useFrontendSearchArticles } from '@/lib/hooks/useFrontendArticles';
import { useEscapeKey } from '@/lib/hooks/useKeyboardShortcut';
import { SearchResults } from './SearchResults';
import { SearchBar } from '@/components/ui/SearchBar';

interface SearchModalProps {
  isOpen: boolean;
  onCloseAction: () => void;
}

export function SearchModal({ isOpen, onCloseAction }: SearchModalProps) {
  const t = useTranslations();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // 防抖处理
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  // 搜索数据
  const { data, isLoading, error } = useFrontendSearchArticles(debouncedQuery, {
    page: 1,
    pageSize: 5, // 模态框中只显示前5个结果
  });

  const results = data?.items || [];
  const totalResults = data?.total || 0;

  // ESC 键关闭
  useEscapeKey(onCloseAction, isOpen);

  // 打开时聚焦输入框
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // 阻止背景滚动
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleSearch = useCallback((searchQuery: string) => {
    setQuery(searchQuery);
  }, []);

  const handleClear = useCallback(() => {
    setQuery('');
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const handleResultClick = useCallback(() => {
    onCloseAction();
  }, [onCloseAction]);

  const handleViewAllResults = useCallback(() => {
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
      onCloseAction();
    }
  }, [query, router, onCloseAction]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && query.trim() && results.length === 0) {
        // 没有结果时按回车跳转到完整搜索页
        handleViewAllResults();
      }
    },
    [query, results.length, handleViewAllResults],
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 背景遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm"
            onClick={onCloseAction}
          />

          {/* 模态框内容 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{
              type: 'spring',
              damping: 25,
              stiffness: 300,
              mass: 0.8,
            }}
            className="fixed inset-0 z-[201] md:inset-auto md:top-20 md:left-1/2 md:-translate-x-1/2 md:w-full md:max-w-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 移动端：全屏模态框 */}
            <div className="h-full md:h-auto md:max-h-[80vh] flex flex-col bg-background md:rounded-2xl md:shadow-2xl md:border md:border-border overflow-hidden">
              {/* 搜索头部 */}
              <div className="p-4 md:p-6 border-b border-border">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">{t('search.title')}</h2>
                  <button
                    onClick={onCloseAction}
                    className="p-2 rounded-full hover:bg-accent transition-colors"
                    aria-label={t('common.close')}
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* 搜索输入框 */}
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => handleSearch(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t('search.placeholder')}
                    className="w-full pl-12 pr-12 py-3 rounded-xl border border-border bg-card text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                    autoFocus
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={handleClear}
                      className="absolute right-4 top-1/2 -translate-y-1/2 p-1 hover:text-primary transition-colors"
                      aria-label={t('search.clear')}
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>

                {/* 快捷键提示 */}
                <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1 px-2 py-1 bg-muted rounded">
                    <Command className="w-3 h-3" />
                    <span>K</span>
                  </div>
                  <span>{t('search.shortcutHint')}</span>
                </div>
              </div>

              {/* 搜索结果区域 */}
              <div className="flex-1 overflow-y-auto p-4 md:p-6">
                <SearchResults
                  query={debouncedQuery}
                  results={results}
                  totalResults={totalResults}
                  isLoading={isLoading}
                  error={error}
                  onArticleClick={handleResultClick}
                />
              </div>

              {/* 底部操作栏 */}
              {query.trim() && results.length > 0 && (
                <div className="p-4 border-t border-border">
                  <button
                    onClick={handleViewAllResults}
                    className="w-full py-3 px-4 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium"
                  >
                    {t('search.viewAllResults')} ({totalResults})
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
