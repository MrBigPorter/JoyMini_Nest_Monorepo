'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Upload,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Eye,
  FileText,
  Tag,
  Download,
} from 'lucide-react';
import { useRequest } from 'ahooks';
import { useToastStore } from '@/store/useToastStore';
import { Card, Badge } from '@/components/UIComponents';
import { blogApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { Button } from '@repo/ui';
import { useTranslation } from '@/hooks/useTranslation';
import { parseFrontmatter } from '@/lib/utils/frontmatter';
import { generateSlugFromFilename } from '@/lib/utils/slug';

// ── Types ──────────────────────────────────────────────────────

interface ScannedArticle {
  filename: string;
  slug: string;
  title: string;
  excerpt?: string;
  content: string;
  tags: string[];
  subDir: string | null;
  exists: boolean;
  fileSize: number;
  lastModified: string;
}

interface ImportResult {
  successCount: number;
  failureCount: number;
  skippedCount: number;
  results: Array<{
    filename: string;
    articleId?: string;
    slug: string;
    success: boolean;
    error?: string;
  }>;
}

// ── Helpers ─────────────────────────────────────────────────────

/** Read a File as text using FileReader API */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`文件读取失败: ${file.name}`));
    reader.readAsText(file);
  });
}

/** Format bytes to human-readable size */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// ── Page Component ──────────────────────────────────────────────

export default function BlogImportPage() {
  const router = useRouter();
  const { addToast } = useToastStore();
  const { t } = useTranslation();

  // ── Refs ────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── State ───────────────────────────────────────────────────
  const [articles, setArticles] = useState<ScannedArticle[]>([]);
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());
  const [previewArticle, setPreviewArticle] = useState<ScannedArticle | null>(
    null,
  );
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [selectAll, setSelectAll] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // ── API: Batch import ───────────────────────────────────────
  const { run: importArticles, loading: importing } = useRequest(
    blogApi.batchImportArticles,
    {
      manual: true,
      onSuccess: (result: ImportResult) => {
        setImportResult(result);
        if (result.successCount > 0) {
          addToast(
            'success',
            `${t('blog_import_imported')} ${result.successCount} ${t('blog_import_articles')}`,
          );
        }
        if (result.failureCount > 0) {
          addToast(
            'error',
            `${result.failureCount} ${t('blog_import_failed')}`,
          );
        }
      },
      onError: (err: Error) => {
        addToast('error', t('blog_import_importFailed'));
        setImportError(err.message || t('blog_import_importFailed'));
      },
    },
  );

  // ── File Processing ─────────────────────────────────────────

  /** Process selected files: read, parse frontmatter, build ScannedArticle[] */
  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      setLoading(true);
      setFileErrors([]);
      setImportResult(null);
      setImportError(null);
      setPreviewArticle(null);

      const parsedArticles: ScannedArticle[] = [];
      const errors: string[] = [];
      const seenFilenames = new Set<string>();

      for (const file of Array.from(files)) {
        // 1. Filter: only .md files
        if (!file.name.toLowerCase().endsWith('.md')) {
          errors.push(`${file.name}: 非 Markdown 文件，已跳过`);
          continue;
        }

        // 2. Deduplicate by filename
        if (seenFilenames.has(file.name)) {
          errors.push(`${file.name}: 重复文件，已跳过`);
          continue;
        }
        seenFilenames.add(file.name);

        // 3. Size check
        if (file.size > MAX_FILE_SIZE) {
          errors.push(
            `${file.name}: 文件过大 (${formatFileSize(file.size)})，超过 10MB 限制，已跳过`,
          );
          continue;
        }

        // 4. Read and parse
        try {
          const text = await readFileAsText(file);
          const parsed = parseFrontmatter(text);

          // Priority: frontmatter slug > filename-derived slug
          const slug = parsed.slug || generateSlugFromFilename(file.name);

          // Fallback title: parsed title > filename without extension
          const title = parsed.title || file.name.replace(/\.md$/i, '');

          parsedArticles.push({
            filename: file.name,
            slug,
            title,
            excerpt: parsed.excerpt,
            content: parsed.content,
            tags: parsed.tags,
            subDir: null, // No subdirectory in browser context
            exists: false, // No DB pre-check; backend handles duplicates
            fileSize: file.size,
            lastModified: new Date(file.lastModified).toISOString(),
          });
        } catch (err) {
          errors.push(`${file.name}: ${(err as Error).message}`);
        }
      }

      setArticles(parsedArticles);
      setFileErrors(errors);
      setSelectedSlugs(new Set(parsedArticles.map((a) => a.slug)));
      setSelectAll(parsedArticles.length > 0);
      setLoading(false);

      // Toast summary
      if (parsedArticles.length === 0) {
        addToast('error', t('blog_import_noFiles'));
      } else {
        addToast(
          'success',
          `${t('blog_import_found')} ${parsedArticles.length} ${t('blog_import_articles')}`,
        );
      }
    },
    [addToast, t],
  );

  /** Handle file input change (user selects via browser picker) */
  const handleFilesSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      await processFiles(files);
      // Reset input so re-selecting the same files triggers onChange
      e.target.value = '';
    },
    [processFiles],
  );

  /** Handle drag-drop */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        await processFiles(files);
      }
    },
    [processFiles],
  );

  // ── Selection Handlers ──────────────────────────────────────

  const handleSelectAll = useCallback(() => {
    if (selectAll) {
      setSelectedSlugs(new Set());
      setSelectAll(false);
    } else {
      // All articles are selectable (no pre-check for "exists")
      setSelectedSlugs(new Set(articles.map((a) => a.slug)));
      setSelectAll(true);
    }
  }, [selectAll, articles]);

  const handleToggleSelect = useCallback((slug: string) => {
    setSelectedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
    setSelectAll(false);
  }, []);

  const handlePreview = useCallback((article: ScannedArticle) => {
    setPreviewArticle(article);
  }, []);

  // ── Import Handler ──────────────────────────────────────────

  const handleImport = useCallback(() => {
    const selectedArticles = articles.filter((a) => selectedSlugs.has(a.slug));
    if (selectedArticles.length === 0) {
      addToast('error', t('blog_import_selectFirst'));
      return;
    }

    importArticles({
      articles: selectedArticles.map((a) => ({
        filename: a.filename,
        slug: a.slug,
        title: a.title,
        excerpt: a.excerpt,
        content: a.content,
        tags: a.tags,
        subdir: null,
        status: 'DRAFT',
      })),
      defaultStatus: 'DRAFT',
      overwrite: false,
    });
  }, [articles, selectedSlugs, importArticles, addToast, t]);

  // ── Retry Failed ────────────────────────────────────────────

  /** Retry only the failed articles from the last import result */
  const handleRetryFailed = useCallback(() => {
    if (!importResult) return;

    const failedSlugs = new Set(
      importResult.results.filter((r) => !r.success).map((r) => r.slug),
    );

    const failedArticles = articles.filter((a) => failedSlugs.has(a.slug));
    if (failedArticles.length === 0) return;

    setImportResult(null);
    setSelectedSlugs(failedSlugs);
    addToast(
      'info',
      t('blog_import_retryHint') ||
        `${failedArticles.length} 篇失败，请确认后重新导入`,
    );
  }, [importResult, articles, addToast, t]);

  // ── Computed ────────────────────────────────────────────────

  const stats = useMemo(() => {
    return {
      total: articles.length,
      selected: selectedSlugs.size,
    };
  }, [articles, selectedSlugs]);

  const previewContent = useMemo(() => {
    if (!previewArticle) return null;
    return previewArticle;
  }, [previewArticle]);

  const hasError = fileErrors.length > 0;

  // ── Render ──────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".md"
        onChange={handleFilesSelected}
        className="hidden"
      />

      {/* Page Header */}
      <PageHeader
        title={t('blog_import_pageTitle') || '导入文章'}
        description={
          t('blog_import_pageDescription') ||
          '选择本地的 Markdown 文件，解析并批量导入到博客'
        }
        showBackButton
        onBack={() => router.push('/blog/articles')}
        breadcrumbs={['Blog', 'Articles', 'Import']}
        buttonText={t('blog_import_scan') || '选择文件'}
        buttonOnClick={() => fileInputRef.current?.click()}
        buttonPrefixIcon={
          loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileText size={18} />
          )
        }
        buttonDisabled={loading}
        action={
          articles.length > 0 &&
          !importResult && (
            <Button
              variant="success"
              onClick={handleImport}
              disabled={importing || selectedSlugs.size === 0}
            >
              {importing ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Download size={18} className="mr-2" />
              )}
              {t('blog_import_import') || '导入选中'} ({stats.selected})
            </Button>
          )
        }
      />

      {/* Stats Bar */}
      {articles.length > 0 && !importResult && (
        <Card>
          <div className="flex items-center gap-6 p-3 text-sm">
            <span className="flex items-center gap-1.5">
              <FileText size={16} className="text-gray-500" />
              {t('blog_import_total') || '总数'}: <strong>{stats.total}</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <Upload size={16} className="text-blue-500" />
              {t('blog_import_selected') || '已选'}:{' '}
              <strong>{stats.selected}</strong>
            </span>
          </div>
        </Card>
      )}

      {/* File Errors Warning */}
      {hasError && !importResult && (
        <Card>
          <div className="p-3">
            <div className="flex items-center gap-2 text-amber-600 mb-2">
              <AlertTriangle size={18} />
              <span className="font-semibold text-sm">
                部分文件处理失败 ({fileErrors.length})
              </span>
            </div>
            <div className="max-h-32 overflow-y-auto space-y-1">
              {fileErrors.map((err, i) => (
                <p key={i} className="text-sm text-red-500 font-mono pl-6">
                  {err}
                </p>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Import Error (full API failure) */}
      {importError && !importResult && (
        <Card>
          <div className="flex items-start gap-3 p-4">
            <XCircle size={20} className="text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-red-600 mb-1">
                {t('blog_import_importFailed') || '导入失败'}
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400 font-mono break-words">
                {importError}
              </p>
              <p className="text-sm text-gray-500 mt-2">
                {t('blog_import_retryHint') ||
                  '文章列表已保留，可调整后重新导入'}
              </p>
            </div>
            <button
              onClick={() => setImportError(null)}
              className="text-gray-400 hover:text-gray-600 shrink-0"
            >
              <XCircle size={16} />
            </button>
          </div>
        </Card>
      )}

      {/* Import Result */}
      {importResult && (
        <Card title={t('blog_import_result') || '导入结果'}>
          <div className="flex items-center gap-4 p-3">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 size={20} />
              <span className="font-semibold">
                {t('blog_import_success') || '成功'}:{' '}
                {importResult.successCount}
              </span>
            </div>
            {importResult.skippedCount > 0 && (
              <div className="flex items-center gap-2 text-amber-600">
                <AlertTriangle size={20} />
                <span className="font-semibold">
                  {t('blog_import_skipped') || '跳过'}:{' '}
                  {importResult.skippedCount}
                </span>
              </div>
            )}
            {importResult.failureCount > 0 && (
              <div className="flex items-center gap-2 text-red-600">
                <XCircle size={20} />
                <span className="font-semibold">
                  {t('blog_import_failed') || '失败'}:{' '}
                  {importResult.failureCount}
                </span>
              </div>
            )}
          </div>
          {/* Action buttons */}
          <div className="border-t px-4 py-3 flex items-center gap-3">
            {importResult.failureCount > 0 && (
              <Button variant="danger" onClick={handleRetryFailed}>
                <XCircle size={16} className="mr-1.5" />
                {t('blog_import_retryFailed') || '重试失败'} (
                {importResult.failureCount})
              </Button>
            )}
            <Button
              variant="primary"
              onClick={() => {
                setImportResult(null);
                setArticles([]);
                setSelectedSlugs(new Set());
                setSelectAll(false);
              }}
            >
              {t('blog_import_scan') || '继续导入'}
            </Button>
          </div>
          {/* Show failures */}
          {importResult.results.filter((r) => !r.success).length > 0 && (
            <div className="border-t px-4 py-3 max-h-40 overflow-y-auto">
              {importResult.results
                .filter((r) => !r.success)
                .map((r) => (
                  <div
                    key={r.filename}
                    className="text-sm text-red-600 flex items-center gap-2 py-1"
                  >
                    <XCircle size={14} />
                    <span className="font-mono">{r.filename}</span>
                    <span>- {r.error}</span>
                  </div>
                ))}
            </div>
          )}
        </Card>
      )}

      {/* Main Content: Article List + Preview */}
      {articles.length > 0 && !importResult && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Article List */}
          <div
            className={`${previewContent ? 'xl:col-span-2' : 'xl:col-span-3'}`}
          >
            <Card>
              {/* Select All */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-white/10">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectAll && articles.length > 0}
                    onChange={handleSelectAll}
                    className="rounded border-gray-300"
                  />
                  {t('blog_import_selectAll') || '全选'}
                </label>
              </div>

              {/* Article rows */}
              <div className="divide-y divide-gray-100 dark:divide-white/10 max-h-[600px] overflow-y-auto">
                {articles.map((article) => {
                  const isSelected = selectedSlugs.has(article.slug);
                  return (
                    <div
                      key={article.slug}
                      className={`flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors ${
                        isSelected ? 'bg-blue-50 dark:bg-blue-500/5' : ''
                      }`}
                    >
                      {/* Checkbox */}
                      <div className="pt-0.5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(article.slug)}
                          className="rounded border-gray-300"
                        />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium truncate">
                              {article.title}
                            </p>
                            <p className="text-xs text-gray-500 font-mono mt-0.5">
                              {article.filename}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge color="green">
                              {t('blog_import_new') || '新文章'}
                            </Badge>
                            <button
                              onClick={() => handlePreview(article)}
                              className="p-1 text-gray-400 hover:text-blue-500 transition-colors"
                              title={t('blog_import_preview') || '预览'}
                            >
                              <Eye size={16} />
                            </button>
                          </div>
                        </div>

                        {/* Meta */}
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
                          {article.tags.length > 0 && (
                            <span className="flex items-center gap-1 truncate max-w-[200px]">
                              <Tag size={12} />
                              {article.tags.join(', ')}
                            </span>
                          )}
                          {article.excerpt && (
                            <span className="truncate max-w-[300px] text-gray-400">
                              {article.excerpt.slice(0, 80)}
                              {article.excerpt.length > 80 ? '...' : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* Preview Panel */}
          {previewContent && (
            <div className="xl:col-span-1">
              <Card title={t('blog_import_preview') || '预览'}>
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-sm truncate">
                      {previewContent.title}
                    </h3>
                    <button
                      onClick={() => setPreviewArticle(null)}
                      className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <XCircle size={16} />
                    </button>
                  </div>

                  <div className="space-y-2 text-xs text-gray-500 mb-3">
                    <div className="flex items-center gap-2">
                      <FileText size={12} />
                      <span className="font-mono">
                        {previewContent.filename}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>Slug:</span>
                      <span className="font-mono">{previewContent.slug}</span>
                    </div>
                    {previewContent.tags.length > 0 && (
                      <div className="flex items-center gap-2">
                        <Tag size={12} />
                        <span>{previewContent.tags.join(', ')}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <span>{t('blog_import_size') || '大小'}:</span>
                      <span>
                        {(previewContent.fileSize / 1024).toFixed(1)} KB
                      </span>
                    </div>
                  </div>

                  {previewContent.excerpt && (
                    <div className="mb-3 p-2 bg-gray-50 dark:bg-white/5 rounded text-sm italic text-gray-600 dark:text-gray-400 border-l-2 border-gray-300">
                      {previewContent.excerpt}
                    </div>
                  )}

                  <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap max-h-[400px] overflow-y-auto bg-gray-50 dark:bg-white/5 rounded p-3 font-mono text-xs leading-relaxed">
                    {previewContent.content.slice(0, 2000)}
                    {previewContent.content.length > 2000 && (
                      <span className="text-gray-400">... (truncated)</span>
                    )}
                  </div>
                </div>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* Empty State — supports drag & drop */}
      {!loading && articles.length === 0 && !importResult && (
        <Card>
          <div
            className={`flex flex-col items-center justify-center py-16 text-gray-400 border-2 border-dashed rounded-lg transition-colors ${
              dragOver
                ? 'border-blue-400 bg-blue-50 dark:bg-blue-500/5'
                : 'border-gray-200 dark:border-white/10'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {dragOver ? (
              <>
                <Upload size={48} className="mb-4 text-blue-400" />
                <p className="text-lg font-medium text-blue-500 mb-2">
                  释放文件以导入
                </p>
                <p className="text-sm text-blue-400">支持 .md 文件</p>
              </>
            ) : (
              <>
                <Search size={48} className="mb-4 opacity-40" />
                <p className="text-lg font-medium mb-2">
                  {t('blog_import_empty') || '还没有选择文件'}
                </p>
                <p className="text-sm text-gray-500 mb-6 text-center max-w-md">
                  {t('blog_import_emptyHint') ||
                    '拖放 .md 文件到此处，或点击下方按钮选择文件'}
                </p>
                <Button
                  variant="primary"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <FileText size={18} className="mr-2" />
                  )}
                  {t('blog_import_scan') || '选择文件'}
                </Button>
              </>
            )}
          </div>
        </Card>
      )}

      {/* Loading overlay during file processing */}
      {loading && articles.length === 0 && (
        <Card>
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Loader2 className="h-10 w-10 animate-spin mb-4" />
            <p className="text-lg font-medium mb-2">正在读取文件...</p>
            <p className="text-sm text-gray-500">正在解析 Markdown 文件</p>
          </div>
        </Card>
      )}
    </div>
  );
}
