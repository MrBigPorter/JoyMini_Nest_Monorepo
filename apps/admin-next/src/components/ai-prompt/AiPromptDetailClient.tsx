'use client';

import React, {
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useRequest } from 'ahooks';
import {
  ArrowLeft,
  Save,
  Plus,
  RefreshCw,
  CheckCircle2,
  X,
  Eye,
  Activity,
  FileDiff,
  ListTree,
  Clock,
  AlertCircle,
  FileText,
  Shield,
  SlidersHorizontal,
} from 'lucide-react';
import { Button, cn } from '@repo/ui';
import { aiPromptApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { useTranslation } from '@/hooks/useTranslation';
import type { TFunc } from '@/hooks/useTranslation';
import type {
  KnowledgePrompt,
  KnowledgePromptVersion,
  PromptDiffResult,
  PromptMetrics,
  CreatePromptVersionPayload,
  PromptToolOption,
} from '@/type/types';
import { configToForm, formToConfig } from './prompt-form-utils';
import type { FormState } from './prompt-form-utils';
import { PromptContentTab } from './PromptContentTab';
import { ScopeTab } from './ScopeTab';
import { AdvancedTab } from './AdvancedTab';
import { PreviewTab } from './PreviewTab';

// ───────── Section keys for collapsible sections ─────────

type SectionKey = 'overview' | 'versions' | 'diff' | 'metrics';

const SECTION_ICONS: Record<
  SectionKey,
  React.ComponentType<{ size?: number }>
> = {
  overview: Eye,
  versions: ListTree,
  diff: FileDiff,
  metrics: Activity,
};

// ───────── Create Version Modal ─────────

function CreateVersionModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [configText, setConfigText] = useState('{\n  \n}');
  const [changeLog, setChangeLog] = useState('');

  const { run: doSave, loading } = useRequest(
    async () => {
      // Parse JSON
      let config: Record<string, unknown>;
      try {
        config = JSON.parse(configText);
      } catch {
        return; // invalid JSON, silently fail (could add error state)
      }

      const payload: CreatePromptVersionPayload = {
        config,
        changeLog: changeLog || undefined,
      };
      // The promptId will come from context — handled in parent
      return payload;
    },
    { manual: true },
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-2xl mx-4 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">Create New Version</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Prompt Config (JSON) *
            </label>
            <textarea
              value={configText}
              onChange={(e) => setConfigText(e.target.value)}
              rows={12}
              className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent text-sm font-mono resize-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Change Log
            </label>
            <input
              value={changeLog}
              onChange={(e) => setChangeLog(e.target.value)}
              placeholder="What changed in this version?"
              className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent text-sm"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              // Parse and save in parent
              onSaved();
            }}
            disabled={loading}
            className="gap-2"
          >
            <Save size={16} />
            {loading ? 'Saving...' : 'Create Version'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ───────── Diff View ─────────

function DiffView({
  promptId,
  versions,
}: {
  promptId: string;
  versions: KnowledgePromptVersion[];
}) {
  const [v1, setV1] = useState<number>(
    () => versions[1]?.version ?? versions[0]?.version ?? 0,
  );
  const [v2, setV2] = useState<number>(() => versions[0]?.version ?? 0);

  const {
    data: diffResult,
    loading,
    refresh,
  } = useRequest(
    () =>
      v1 && v2 && v1 !== v2
        ? aiPromptApi.diffVersions(promptId, Math.min(v1, v2), Math.max(v1, v2))
        : Promise.resolve(null),
    { refreshDeps: [v1, v2] },
  );

  const diff = diffResult?.diff ?? [];

  const DIFF_COLORS: Record<string, string> = {
    added:
      'text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-900/20',
    removed: 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-900/20',
    modified:
      'text-yellow-600 bg-yellow-50 dark:text-yellow-400 dark:bg-yellow-900/20',
    unchanged: 'text-gray-400',
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Version Selectors */}
      <div className="flex items-center gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Version 1</label>
          <select
            value={v1}
            onChange={(e) => setV1(Number(e.target.value))}
            className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent text-sm"
          >
            {versions.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version} {v.isActive ? '(active)' : ''}
              </option>
            ))}
          </select>
        </div>
        <span className="text-gray-400 mt-6">→</span>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Version 2</label>
          <select
            value={v2}
            onChange={(e) => setV2(Number(e.target.value))}
            className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent text-sm"
          >
            {versions.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version} {v.isActive ? '(active)' : ''}
              </option>
            ))}
          </select>
        </div>
        <Button variant="ghost" size="sm" onClick={refresh} className="mt-6">
          <RefreshCw size={16} />
        </Button>
      </div>

      {/* Version Info */}
      {diffResult && (
        <div className="text-xs text-gray-500 flex gap-4">
          <span>
            v{diffResult.v1.version}: {diffResult.v1.changeLog ?? '—'}
          </span>
          <span>→</span>
          <span>
            v{diffResult.v2.version}: {diffResult.v2.changeLog ?? '—'}
          </span>
        </div>
      )}

      {/* Diff Table */}
      {loading ? (
        <div className="flex items-center justify-center py-8 text-gray-400">
          <RefreshCw size={20} className="animate-spin" />
        </div>
      ) : diff.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          No differences found
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                <th className="px-4 py-3 text-left font-medium text-gray-500 w-40">
                  Field
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Type
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Old Value
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  New Value
                </th>
              </tr>
            </thead>
            <tbody>
              {diff.map((item) => (
                <tr
                  key={item.field}
                  className="border-b border-gray-100 dark:border-white/5"
                >
                  <td className="px-4 py-3 font-mono text-xs font-medium">
                    {item.field}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-block px-2 py-0.5 rounded text-xs font-medium',
                        DIFF_COLORS[item.type] ?? '',
                      )}
                    >
                      {item.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500 max-w-xs truncate">
                    {item.type !== 'added'
                      ? (JSON.stringify(item.oldValue, null, 2)?.slice(
                          0,
                          200,
                        ) ?? '—')
                      : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500 max-w-xs truncate">
                    {item.type !== 'removed'
                      ? (JSON.stringify(item.newValue, null, 2)?.slice(
                          0,
                          200,
                        ) ?? '—')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ───────── Metrics View (Step 10) ─────────

function MetricsView({ promptId }: { promptId: string }) {
  const { data, loading, refresh } = useRequest(
    () => aiPromptApi.getMetrics(promptId),
    { refreshDeps: [promptId] },
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <RefreshCw size={24} className="animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-8 text-gray-400">
        No metrics data available
      </div>
    );
  }

  const { versions, evalStats } = data;

  // Build metrics lookup by version
  const evalByVersion = new Map(evalStats.map((s) => [s.version, s]));

  return (
    <div className="flex flex-col gap-6">
      {/* Per-Version Metrics Table */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold">Version Metrics Comparison</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Version
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Status
                </th>
                <th className="px-4 py-3 text-center font-medium text-gray-500">
                  Conversations
                </th>
                <th className="px-4 py-3 text-center font-medium text-gray-500">
                  Avg Tool Fails
                </th>
                <th className="px-4 py-3 text-center font-medium text-gray-500">
                  Avg Latency (ms)
                </th>
                <th className="px-4 py-3 text-center font-medium text-gray-500">
                  Avg Tokens
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Change Log
                </th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => {
                const stats = evalByVersion.get(v.version);
                return (
                  <tr
                    key={v.version}
                    className={cn(
                      'border-b border-gray-100 dark:border-white/5',
                      v.isActive && 'bg-blue-50/50 dark:bg-blue-900/10',
                    )}
                  >
                    <td className="px-4 py-3 font-mono text-sm">
                      v{v.version}
                      {v.isActive && (
                        <span className="ml-2 text-xs text-blue-600 dark:text-blue-400">
                          (active)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {v.metrics ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-600">
                          <CheckCircle2 size={12} />
                          Has metrics
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">No data</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {stats ? (
                        <span className="font-mono text-sm">
                          {stats._count.id}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {stats?._avg.toolFailCount != null ? (
                        <span className="font-mono text-sm">
                          {stats._avg.toolFailCount.toFixed(1)}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {stats?._avg.latencyMs != null ? (
                        <span className="font-mono text-sm">
                          {Math.round(stats._avg.latencyMs)}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {stats?._avg.totalTokens != null ? (
                        <span className="font-mono text-sm">
                          {Math.round(stats._avg.totalTokens)}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">
                      {v.changeLog ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
            <Activity size={16} />
            Total Versions
          </div>
          <div className="text-2xl font-bold">{versions.length}</div>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
            <Clock size={16} />
            Total Conversations
          </div>
          <div className="text-2xl font-bold">
            {evalStats.reduce((sum, s) => sum + s._count.id, 0)}
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
            <AlertCircle size={16} />
            Active Version
          </div>
          <div className="text-2xl font-bold">
            v{versions.find((v) => v.isActive)?.version ?? '—'}
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────── Main Detail Component ─────────

export function AiPromptDetailClient() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const promptId = params.id;

  const [showCreateVersion, setShowCreateVersion] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<SectionKey>>(
    () => new Set<SectionKey>(),
  );

  const toggleSection = useCallback((key: SectionKey) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // Load prompt data
  const {
    data: prompt,
    loading,
    refresh,
  } = useRequest(() => aiPromptApi.getById(promptId), {
    refreshDeps: [promptId],
  });

  const versions = useMemo(() => prompt?.versions ?? [], [prompt?.versions]);

  // ── Activate version ──

  const { run: doActivate, loading: activating } = useRequest(
    async (version: number) => {
      await aiPromptApi.activateVersion(promptId, version);
      await refresh();
    },
    { manual: true },
  );

  // ── Create version ──

  const { run: doCreateVersion, loading: creatingVersion } = useRequest(
    async (config: Record<string, unknown>, changeLog?: string) => {
      await aiPromptApi.createVersion(promptId, { config, changeLog });
      setShowCreateVersion(false);
      await refresh();
    },
    { manual: true },
  );

  // ── Render ──

  if (loading && !prompt) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <RefreshCw size={24} className="animate-spin" />
      </div>
    );
  }

  if (!prompt) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
        <AlertCircle size={48} className="mb-3" />
        <p>Prompt not found</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => router.push('/ai-prompt')}
        >
          Back to list
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <PageHeader
        title={prompt.displayName}
        description={`${prompt.name} · v${prompt.activeVersion} · ${prompt.category}`}
        showBackButton
        onBack={() => router.push('/ai-prompt')}
        backButtonLabel="Back to prompts"
      />

      {/* ── Section: Overview ── */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <button
          onClick={() => toggleSection('overview')}
          className="w-full flex items-center justify-between px-5 py-4 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Eye size={18} className="text-gray-500" />
            <h3 className="text-sm font-semibold">Overview</h3>
          </div>
          <span className="text-gray-400 text-lg transition-transform duration-200"
            style={{ transform: collapsedSections.has('overview') ? 'rotate(-90deg)' : 'rotate(0deg)' }}
          >
            ▼
          </span>
        </button>
        {!collapsedSections.has('overview') && (
          <div className="p-5">
            <div>
              <h4 className="text-sm font-semibold mb-4">Prompt Details</h4>
              <div className="flex flex-col gap-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Name</span>
                  <span className="font-mono text-xs">{prompt.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Display Name</span>
                  <span>{prompt.displayName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Category</span>
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                    {prompt.category}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Domain</span>
                  <span className="text-gray-700 dark:text-gray-300">
                    {prompt.domain ?? '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">TS Fallback</span>
                  <span>{prompt.tsFallback ? 'Enabled' : 'Disabled'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Active Version</span>
                  <span className="font-mono">v{prompt.activeVersion}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Status</span>
                  <span
                    className={cn(
                      'px-2 py-0.5 rounded text-xs font-medium',
                      prompt.status === 'active'
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
                    )}
                  >
                    {prompt.status}
                  </span>
                </div>
                {prompt.description && (
                  <div className="flex flex-col gap-1 pt-2 border-t border-gray-100 dark:border-gray-800">
                    <span className="text-gray-500">Description</span>
                    <p className="text-gray-700 dark:text-gray-300">
                      {prompt.description}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── Section: Versions ── */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div
          role="button"
          tabIndex={0}
          onClick={() => toggleSection('versions')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSection('versions'); } }}
          className="w-full flex items-center justify-between px-5 py-4 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <ListTree size={18} className="text-gray-500" />
            <h3 className="text-sm font-semibold">Version History</h3>
          </div>
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              className="gap-1"
              onClick={(e) => {
                e.stopPropagation();
                setShowCreateVersion(true);
              }}
            >
              <Plus size={14} />
              New Version
            </Button>
            <span className="text-gray-400 text-lg transition-transform duration-200"
              style={{ transform: collapsedSections.has('versions') ? 'rotate(-90deg)' : 'rotate(0deg)' }}
            >
              ▼
            </span>
          </div>
        </div>
        {!collapsedSections.has('versions') && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Version</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Change Log</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Created</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr
                    key={v.version}
                    className={cn(
                      'border-b border-gray-100 dark:border-white/5',
                      v.isActive && 'bg-blue-50/50 dark:bg-blue-900/10',
                    )}
                  >
                    <td className="px-4 py-3 font-mono text-sm">v{v.version}</td>
                    <td className="px-4 py-3">
                      {v.isActive ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                          <CheckCircle2 size={12} />
                          Active
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">Inactive</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 max-w-[300px] truncate">
                      {v.changeLog ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(v.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!v.isActive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => doActivate(v.version)}
                          disabled={activating}
                        >
                          <CheckCircle2 size={16} className="text-green-500" />
                          <span className="ml-1">Activate</span>
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Section: Diff ── */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <button
          onClick={() => toggleSection('diff')}
          className="w-full flex items-center justify-between px-5 py-4 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors"
        >
          <div className="flex items-center gap-2">
            <FileDiff size={18} className="text-gray-500" />
            <h3 className="text-sm font-semibold">Version Diff</h3>
          </div>
          <span className="text-gray-400 text-lg transition-transform duration-200"
            style={{ transform: collapsedSections.has('diff') ? 'rotate(-90deg)' : 'rotate(0deg)' }}
          >
            ▼
          </span>
        </button>
        {!collapsedSections.has('diff') && (
          <div className="p-5">
            <DiffView promptId={promptId} versions={versions} />
          </div>
        )}
      </section>

      {/* ── Section: Metrics ── */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <button
          onClick={() => toggleSection('metrics')}
          className="w-full flex items-center justify-between px-5 py-4 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Activity size={18} className="text-gray-500" />
            <h3 className="text-sm font-semibold">Metrics</h3>
          </div>
          <span className="text-gray-400 text-lg transition-transform duration-200"
            style={{ transform: collapsedSections.has('metrics') ? 'rotate(-90deg)' : 'rotate(0deg)' }}
          >
            ▼
          </span>
        </button>
        {!collapsedSections.has('metrics') && (
          <div className="p-5">
            <MetricsView promptId={promptId} />
          </div>
        )}
      </section>

      {/* Create Version Modal */}
      {showCreateVersion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-2xl mx-4 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold">Create New Version</h2>
              <button
                onClick={() => setShowCreateVersion(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
              >
                <X size={20} />
              </button>
            </div>

            <VersionFormContent
              creatingVersion={creatingVersion}
              onCreateVersion={async (config, changeLog) => {
                doCreateVersion(config, changeLog);
              }}
              onClose={() => setShowCreateVersion(false)}
              domainName={prompt.domain ?? ''}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ───────── Version Form Content (Structured Form) ─────────

type FormTabKey = 'content' | 'scope' | 'advanced' | 'preview';

const FORM_TABS: {
  key: FormTabKey;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}[] = [
  { key: 'content', label: 'Prompt Content', icon: FileText },
  { key: 'scope', label: 'Scope', icon: Shield },
  { key: 'advanced', label: 'Advanced', icon: SlidersHorizontal },
  { key: 'preview', label: 'Preview', icon: Eye },
];

function VersionFormContent({
  creatingVersion,
  onCreateVersion,
  onClose,
  domainName,
}: {
  creatingVersion: boolean;
  onCreateVersion: (
    config: Record<string, unknown>,
    changeLog?: string,
  ) => Promise<void>;
  onClose: () => void;
  domainName: string;
}) {
  const [formTab, setFormTab] = useState<FormTabKey>('content');
  const [changeLog, setChangeLog] = useState('');

  // ── Template & tool selector state ──
  const [availableTools, setAvailableTools] = useState<PromptToolOption[]>([]);
  const [templateLocked, setTemplateLocked] = useState(false);

  // Initialize form from default empty state (no pre-fill when creating new)
  const [form, setForm] = useState<FormState>(() =>
    configToForm({} as Record<string, unknown>),
  );

  const patchForm = useCallback((patch: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  // ── Load template when scopeDomain changes ──
  const { run: loadTemplate } = useRequest(
    async (domain: string) => {
      const [templateRes, toolsRes] = await Promise.all([
        aiPromptApi.getTemplate(domain),
        aiPromptApi.getTools(domain),
      ]);
      const config = templateRes.config as Record<string, unknown>;
      setForm((prev) => ({
        ...prev,
        workflow: (config.workflow as string) ?? prev.workflow,
        domainRules: (config.domainRules as string) ?? prev.domainRules,
        examples: (config.examples as string) ?? prev.examples,
        templateDomain: domain,
        isTemplateLoaded: true,
      }));
      setAvailableTools(toolsRes.tools ?? []);
      setTemplateLocked(true);
    },
    { manual: true },
  );

  const prevDomainRef = useRef('');

  useEffect(() => {
    const d = domainName.trim().toLowerCase();
    if (d && d !== prevDomainRef.current) {
      prevDomainRef.current = d;
      loadTemplate(d);
    }
  }, [domainName, loadTemplate]);

  const handleSave = async () => {
    // Convert form state to AgentPromptConfig JSON and save
    const config = formToConfig(
      form,
      domainName,
      availableTools.length > 0 ? availableTools : undefined,
    );
    await onCreateVersion(config, changeLog || undefined);
  };

  const isComplete =
    form.role.trim() &&
    form.workflow.trim() &&
    form.examples.trim() &&
    form.scopeDomain.trim();

  return (
    <>
      {/* Form Tab Bar */}
      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-700 mb-4">
        {FORM_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFormTab(tab.key)}
            className={cn(
              'flex items-center gap-2 px-3 py-2 text-xs font-medium border-b-2 transition-colors',
              formTab === tab.key
                ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300',
            )}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Form Tab Content */}
      <div className="min-h-[350px] max-h-[500px] overflow-y-auto pr-1">
        {formTab === 'content' && (
          <PromptContentTab
            form={form}
            onChange={patchForm}
            tools={availableTools}
            templateLocked={templateLocked}
          />
        )}
        {formTab === 'scope' && <ScopeTab form={form} onChange={patchForm} />}
        {formTab === 'advanced' && (
          <AdvancedTab form={form} onChange={patchForm} />
        )}
        {formTab === 'preview' && (
          <PreviewTab form={form} domainName={domainName} />
        )}
      </div>

      {/* Change Log */}
      <div className="flex flex-col gap-1 mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Change Log
        </label>
        <input
          value={changeLog}
          onChange={(e) => setChangeLog(e.target.value)}
          placeholder="What changed in this version?"
          className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent text-sm"
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 mt-4">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={creatingVersion || !isComplete}
          className="gap-2"
          title={
            !isComplete
              ? 'Please fill in all required fields (Role, Workflow, Examples, Scope Domain)'
              : 'Save version'
          }
        >
          <Save size={16} />
          {creatingVersion ? 'Saving...' : 'Create Version'}
        </Button>
      </div>
    </>
  );
}
