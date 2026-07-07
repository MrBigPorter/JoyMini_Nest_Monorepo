'use client';

import { useRouter } from 'next/navigation';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRequest } from 'ahooks';
import {
  Plus,
  RefreshCw,
  Eye,
  Edit2,
  Trash2,
  Search,
  X,
  Save,
  Sparkles,
  FileText,
  Shield,
  SlidersHorizontal,
} from 'lucide-react';
import { ModalManager, Button, cn } from '@repo/ui';
import { aiPromptApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { useTranslation } from '@/hooks/useTranslation';
import type { TFunc } from '@/hooks/useTranslation';
import type {
  KnowledgePrompt,
  CreatePromptPayload,
  UpdatePromptPayload,
  QueryPromptParams,
  PromptToolOption,
} from '@/type/types';
import { FormState, configToForm, formToConfig } from './prompt-form-utils';
import { PromptContentTab } from './PromptContentTab';
import { ScopeTab } from './ScopeTab';
import { AdvancedTab } from './AdvancedTab';
import { PreviewTab } from './PreviewTab';

// ───────── helpers ─────────

const CATEGORY_OPTIONS = ['agent', 'system', 'intent'];
const STATUS_OPTIONS = ['active', 'inactive', 'draft', 'archived'];

const STATUS_BADGE: Record<string, string> = {
  active:
    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  inactive:
    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  draft: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  archived: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
};

const CATEGORY_BADGE: Record<string, string> = {
  agent: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  system:
    'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  intent:
    'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
};

// ───────── Tab constants ─────────

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

// ───────── Create/Edit Modal ─────────

interface FormModalProps {
  editing: KnowledgePrompt | null;
  onClose: () => void;
  onSaved: () => void;
  t: TFunc;
}

function FormModal({ editing, onClose, onSaved, t }: FormModalProps) {
  console.log('>>> FormModal MOUNTED, isEdit:', !!editing); // ← 加这行

  const isEdit = !!editing;

  // ── Metadata fields ──
  const [name, setName] = useState(editing?.name ?? '');
  const [displayName, setDisplayName] = useState(editing?.displayName ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [category, setCategory] = useState(editing?.category ?? 'agent');
  const [domain, setDomain] = useState(editing?.domain ?? '');

  // ── Version config form state (only for create) ──
  const [form, setForm] = useState<FormState>(() => {
    if (isEdit) {
      // Try to load existing config from the active version for editing
      const activeVersion = editing?.versions?.find((v) => v.isActive);
      return activeVersion?.config
        ? configToForm(activeVersion.config as Record<string, unknown>)
        : configToForm({} as Record<string, unknown>);
    }
    return configToForm({} as Record<string, unknown>);
  });
  const [formTab, setFormTab] = useState<FormTabKey>('content');

  // ── Template & tool selector state ──
  const [availableTools, setAvailableTools] = useState<PromptToolOption[]>([]);
  const [templateLocked, setTemplateLocked] = useState(false);

  const patchForm = useCallback((patch: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  // Fetch domain options from templates API for the dropdown
  const { data: templatesData } = useRequest(aiPromptApi.getTemplates);
  const templateOptions = templatesData?.templates ?? [];

  // ── Load template when domain is selected (create mode) ──
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

  // Load tools on mount for edit mode (template fields already in config)
  useEffect(() => {
    if (isEdit && form.templateDomain) {
      aiPromptApi.getTools(form.templateDomain).then((res) => {
        if (res.tools) setAvailableTools(res.tools);
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { run: doSave, loading } = useRequest(
    async () => {
      if (isEdit) {
        // Edit: metadata + create new version with updated config
        const payload: UpdatePromptPayload = { displayName };
        if (description) payload.description = description;
        await aiPromptApi.update(editing.id, payload);

        // Create a new version with the updated config
        const versionConfig = formToConfig(
          form,
          editing.domain || editing.name,
          availableTools.length > 0 ? availableTools : undefined,
        );
        await aiPromptApi.createVersion(editing.id, {
          config: versionConfig,
          changeLog: 'Updated via edit form',
        });
      } else {
        // Create: metadata + initial version config in one API call
        const versionConfig = formToConfig(
          form,
          domain || name,
          availableTools.length > 0 ? availableTools : undefined,
        );
        const payload: CreatePromptPayload = {
          name,
          displayName,
          description: description || undefined,
          category,
          domain: domain || undefined,
          config: versionConfig,
        };
        await aiPromptApi.create(payload);
      }
      onSaved();
    },
    { manual: true },
  );

  const isNameValid = !isEdit ? !!name.trim() : true;
  const isDisplayNameValid = !!displayName.trim();
  const isConfigComplete =
    domain.trim() &&
    form.role.trim() &&
    form.workflow.trim() &&
    form.examples.trim() &&
    form.scopeDomain.trim();
  const canSave =
    isNameValid && isDisplayNameValid && (isEdit || isConfigComplete);

  // ── Render ──

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-4xl mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">
            {isEdit ? t('edit') : 'Create New Prompt'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
          >
            <X size={20} />
          </button>
        </div>

        {/* ── Metadata Section ── */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 mb-4">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wide">
            Basic Info
          </h3>
          <div className="flex flex-col gap-4">
            {/* Name + Display Name row */}
            <div className="grid grid-cols-2 gap-4">
              {!isEdit && (
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. order-agent"
                    className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent text-sm"
                  />
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Display Name <span className="text-red-500">*</span>
                </label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Order Agent"
                  className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent text-sm"
                />
              </div>
            </div>

            {/* Description */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('knowledgeBase.description')}
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent text-sm resize-none"
              />
            </div>

            {/* Category + Domain row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Category <span className="text-red-500">*</span>
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  disabled={isEdit}
                  className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent text-sm"
                >
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              {!isEdit && (
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Domain <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={domain}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDomain(val);
                      if (val) loadTemplate(val);
                    }}
                    className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent text-sm"
                  >
                    <option value="">Select domain...</option>
                    {templateOptions.map((t) => (
                      <option key={t.domain} value={t.domain}>
                        {t.label} ({t.domain})
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-gray-400">
                    Select a domain to auto-load template and tools
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Version Config Section ── */}
        <>
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wide">
            Version Config
          </h3>

          {/* Tab Bar */}
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

          {/* Tab Content */}
          <div className="min-h-[300px] max-h-[400px] overflow-y-auto pr-1">
            {formTab === 'content' && (
              <PromptContentTab
                form={form}
                onChange={patchForm}
                tools={availableTools}
                templateLocked={templateLocked}
              />
            )}
            {formTab === 'scope' && (
              <ScopeTab form={form} onChange={patchForm} />
            )}
            {formTab === 'advanced' && (
              <AdvancedTab form={form} onChange={patchForm} />
            )}
            {formTab === 'preview' && (
              <PreviewTab form={form} domainName={domain || name} />
            )}
          </div>
        </>

        {/* ── Buttons ── */}
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            onClick={doSave}
            disabled={loading || !canSave}
            className="gap-2"
          >
            <Save size={16} />
            {loading ? t('saving') : isEdit ? t('save') : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ───────── Main Component ─────────

export function AiPromptClient() {
  const router = useRouter();
  const { t } = useTranslation();

  // Filters
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Modal
  const [formModal, setFormModal] = useState<KnowledgePrompt | null | false>(
    false,
  );

  // Prompt list
  const queryParams = useMemo<QueryPromptParams>(() => {
    const params: QueryPromptParams = { page: 1, pageSize: 100 };
    if (search.trim()) params.search = search.trim();
    if (categoryFilter) params.category = categoryFilter;
    if (statusFilter) params.status = statusFilter;
    return params;
  }, [search, categoryFilter, statusFilter]);

  const { data, loading, refresh } = useRequest(
    () => aiPromptApi.list(queryParams),
    { refreshDeps: [queryParams] },
  );

  const prompts = useMemo(
    () => (data as { items: KnowledgePrompt[] } | undefined)?.items ?? [],
    [data],
  );

  // ── Actions ──

  const handleDelete = (prompt: KnowledgePrompt) => {
    ModalManager.open({
      title: t('knowledgeBase.deleteConfirm'),
      confirmText: t('save'),
      onConfirm: async () => {
        await aiPromptApi.delete(prompt.id);
        await refresh();
      },
    });
  };

  // ── Render ──

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="AI Prompt Management"
        description="Manage AI agent prompts, versions, and evaluation metrics"
        searchBar={
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('knowledgeBase.searchPlaceholder')}
              className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent text-sm"
            />
          </div>
        }
        buttonText={t('knowledgeBase.create')}
        buttonOnClick={() => setFormModal(null)}
        secondaryButtonText={t('knowledgeBase.refresh')}
        secondaryButtonOnClick={refresh}
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent text-sm"
        >
          <option value="">All Categories</option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent text-sm"
        >
          <option value="">All Status</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <section className="rounded-2xl border border-gray-100 bg-white dark:border-white/10 dark:bg-gray-900/50">
        {loading && prompts.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <RefreshCw size={24} className="animate-spin" />
          </div>
        ) : prompts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Sparkles size={48} className="mb-3 opacity-40" />
            <p>{t('knowledgeBase.noDocuments')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-white/10">
                  <th className="px-5 py-4 text-left font-medium text-gray-500">
                    Name
                  </th>
                  <th className="px-4 py-4 text-left font-medium text-gray-500">
                    Display Name
                  </th>
                  <th className="px-4 py-4 text-left font-medium text-gray-500">
                    Category
                  </th>
                  <th className="px-4 py-4 text-left font-medium text-gray-500">
                    Domain
                  </th>
                  <th className="px-4 py-4 text-center font-medium text-gray-500">
                    Active Version
                  </th>
                  <th className="px-4 py-4 text-left font-medium text-gray-500">
                    Status
                  </th>
                  <th className="px-4 py-4 text-right font-medium text-gray-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {prompts.map((prompt) => (
                  <tr
                    key={prompt.id}
                    className="border-b border-gray-50 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer"
                    onClick={() => {
                      router.push(`/ai-prompt/${prompt.id}`);
                    }}
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <Sparkles
                          size={16}
                          className="text-purple-500 shrink-0"
                        />
                        <span className="font-mono text-xs text-gray-800 dark:text-gray-200">
                          {prompt.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-gray-800 dark:text-gray-200">
                      {prompt.displayName}
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={cn(
                          'inline-block px-2 py-0.5 rounded text-xs font-medium',
                          CATEGORY_BADGE[prompt.category] ?? '',
                        )}
                      >
                        {prompt.category}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-gray-500">
                      {prompt.domain ?? '—'}
                    </td>
                    <td className="px-4 py-4 text-center font-mono text-sm">
                      v{prompt.activeVersion}
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={cn(
                          'inline-block px-2 py-0.5 rounded text-xs font-medium',
                          STATUS_BADGE[prompt.status] ?? '',
                        )}
                      >
                        {prompt.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            router.push(`/ai-prompt/${prompt.id}`);
                          }}
                        >
                          <Eye size={16} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            setFormModal(prompt);
                          }}
                        >
                          <Edit2 size={16} />
                        </Button>
                        {prompt.status !== 'archived' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e: React.MouseEvent) => {
                              e.stopPropagation();
                              handleDelete(prompt);
                            }}
                          >
                            <Trash2 size={16} className="text-red-500" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Form Modal */}
      {formModal !== false && (
        <FormModal
          editing={formModal}
          onClose={() => setFormModal(false)}
          onSaved={() => {
            setFormModal(false);
            refresh();
          }}
          t={t}
        />
      )}
    </div>
  );
}
