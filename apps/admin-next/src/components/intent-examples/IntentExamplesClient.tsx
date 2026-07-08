'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useRequest } from 'ahooks';
import { Button, cn, ModalManager } from '@repo/ui';
import { PageHeader } from '@/components/scaffold/PageHeader';
import { intentExamplesApi } from '@/api';
import type {
  IntentExampleGroup,
  IntentExampleSection,
  TestClassificationResponse,
} from '@/type/types';
import {
  RefreshCw,
  Save,
  TestTube,
  X,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  FileText,
  ChevronDown,
  ChevronRight,
  Layers,
} from 'lucide-react';
import {
  parseSections,
  flattenSections,
  serializeToTsFormat,
  type ParsedSection,
} from './parseSections';

// ============================================================
// Domain Tag Color Map
// ============================================================
const DOMAIN_COLORS: Record<string, string> = {
  wallet: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  order: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  coupon:
    'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  user: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  product: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300',
  'lucky-draw':
    'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  kyc: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  rag: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  general: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
};

function getDomainColor(domain: string): string {
  return (
    DOMAIN_COLORS[domain] ??
    'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300'
  );
}

// ============================================================
// Create Domain Modal
// ============================================================
interface CreateModalProps {
  onClose: () => void;
  onSaved: () => void;
}

function CreateModal({ onClose, onSaved }: CreateModalProps) {
  const [domain, setDomain] = useState('');
  const [rawText, setRawText] = useState('');
  const [sections, setSections] = useState<ParsedSection[]>([]);
  const [parsed, setParsed] = useState(false);

  const { run: doCreate, loading } = useRequest(
    async () => {
      const sentences = flattenSections(sections);
      await intentExamplesApi.createDomain({
        domain: domain.trim(),
        sentences,
      });
    },
    {
      manual: true,
      onSuccess: () => {
        onSaved();
        onClose();
      },
    },
  );

  const handleParse = () => {
    const result = parseSections(rawText);
    setSections(result);
    setParsed(true);
  };

  const updateSectionSentence = (
    sectionIdx: number,
    sentenceIdx: number,
    value: string,
  ) => {
    const next = [...sections];
    next[sectionIdx] = {
      ...next[sectionIdx],
      sentences: next[sectionIdx].sentences.map((s, i) =>
        i === sentenceIdx ? value : s,
      ),
    };
    setSections(next);
  };

  const removeSectionSentence = (sectionIdx: number, sentenceIdx: number) => {
    const next = [...sections];
    next[sectionIdx] = {
      ...next[sectionIdx],
      sentences: next[sectionIdx].sentences.filter((_, i) => i !== sentenceIdx),
    };
    setSections(next);
  };

  const addSectionSentence = (sectionIdx: number) => {
    const next = [...sections];
    next[sectionIdx] = {
      ...next[sectionIdx],
      sentences: [...next[sectionIdx].sentences, ''],
    };
    setSections(next);
  };

  const totalSentences = sections.reduce(
    (sum, s) => sum + s.sentences.length,
    0,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-3xl mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              Create New Domain
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Add a new intent classification domain
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
          >
            <X size={20} />
          </button>
        </div>

        {/* Domain name */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Domain Name
          </label>
          <input
            value={domain}
            onChange={(e) =>
              setDomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
            }
            placeholder="e.g. shipping, support, referral"
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* Paste TS format */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Paste Sentences (coupon.ts format or plain list)
          </label>
          <textarea
            value={rawText}
            onChange={(e) => {
              setRawText(e.target.value);
              setParsed(false);
            }}
            placeholder={`// ── Section Name ──\n'Sentence one',\n'Sentence two',\n\n// ── Another Section ──\n'Sentence three',`}
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y font-mono"
            rows={6}
          />
          <Button
            onClick={handleParse}
            disabled={!rawText.trim()}
            variant="outline"
            size="sm"
            className="mt-2 gap-2"
          >
            <FileText size={14} />
            Parse Sections
          </Button>
          {parsed && (
            <span className="ml-3 text-sm text-green-600 dark:text-green-400">
              Parsed {totalSentences} sentences in {sections.length} sections
            </span>
          )}
        </div>

        {/* Parsed sections preview */}
        {sections.length > 0 && (
          <div className="mb-6 space-y-3 max-h-64 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg p-3">
            {sections.map((sec, si) => (
              <SectionGroup
                key={si}
                title={sec.section}
                sentences={sec.sentences}
                onUpdateSentence={(i, v) => updateSectionSentence(si, i, v)}
                onRemoveSentence={(i) => removeSectionSentence(si, i)}
                onAddSentence={() => addSectionSentence(si)}
              />
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
          <Button onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button
            onClick={doCreate}
            disabled={loading || !domain.trim() || totalSentences === 0}
            className="gap-2"
          >
            <Save size={16} />
            {loading ? 'Creating...' : 'Create & Embed'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Section Group (collapsible)
// ============================================================
interface SectionGroupProps {
  title: string;
  sentences: string[];
  onUpdateSentence: (index: number, value: string) => void;
  onRemoveSentence: (index: number) => void;
  onAddSentence: () => void;
  collapsible?: boolean;
}

function SectionGroup({
  title,
  sentences,
  onUpdateSentence,
  onRemoveSentence,
  onAddSentence,
  collapsible = true,
}: SectionGroupProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={() => collapsible && setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800/50 text-sm font-medium text-gray-700 dark:text-gray-300"
      >
        <span>
          {title} ({sentences.length})
        </span>
        {collapsible &&
          (collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />)}
      </button>
      {!collapsed && (
        <div className="p-3 space-y-2">
          {sentences.map((s, i) => (
            <div key={i} className="flex items-start gap-2">
              <textarea
                value={s}
                onChange={(e) => onUpdateSentence(i, e.target.value)}
                className="flex-1 min-h-[2.5rem] px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
                rows={Math.max(1, Math.ceil(s.length / 60))}
              />
              <button
                onClick={() => onRemoveSentence(i)}
                className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg flex-shrink-0 mt-1"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <Button
            onClick={onAddSentence}
            variant="outline"
            size="sm"
            className="gap-1"
          >
            <Plus size={14} />
            Add Sentence
          </Button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Edit Modal (upgraded with sections + append/replace)
// ============================================================
interface EditModalProps {
  group: IntentExampleGroup;
  onClose: () => void;
  onSaved: () => void;
}

function EditModal({ group, onClose, onSaved }: EditModalProps) {
  // Initialize sections from group.sections or parse from flat examples
  const [sections, setSections] = useState<ParsedSection[]>(() => {
    if (group.sections && group.sections.length > 0) {
      return group.sections.map((s) => ({
        section: s.section,
        sentences: [...s.sentences],
      }));
    }
    // Fallback: wrap flat examples in a single section
    return [{ section: 'General', sentences: [...group.examples] }];
  });
  const [rawText, setRawText] = useState('');
  const [saveMode, setSaveMode] = useState<'replace' | 'append'>('replace');

  const { run: doSave, loading } = useRequest(
    async () => {
      const sentences = flattenSections(sections);
      await intentExamplesApi.updateDomain(group.name, {
        sentences: sentences.filter((s) => s.trim().length > 0),
        mode: saveMode,
      });
    },
    {
      manual: true,
      onSuccess: () => {
        onSaved();
        onClose();
      },
    },
  );

  const handleParse = () => {
    const result = parseSections(rawText);
    if (result.length > 0) {
      // Merge with existing sections or replace
      if (saveMode === 'append') {
        setSections((prev) => mergeSections(prev, result));
      } else {
        setSections(result);
      }
      setRawText('');
    }
  };

  const updateSectionSentence = (
    sectionIdx: number,
    sentenceIdx: number,
    value: string,
  ) => {
    const next = [...sections];
    next[sectionIdx] = {
      ...next[sectionIdx],
      sentences: next[sectionIdx].sentences.map((s, i) =>
        i === sentenceIdx ? value : s,
      ),
    };
    setSections(next);
  };

  const removeSectionSentence = (sectionIdx: number, sentenceIdx: number) => {
    const next = [...sections];
    next[sectionIdx] = {
      ...next[sectionIdx],
      sentences: next[sectionIdx].sentences.filter((_, i) => i !== sentenceIdx),
    };
    setSections(next);
  };

  const addSectionSentence = (sectionIdx: number) => {
    const next = [...sections];
    next[sectionIdx] = {
      ...next[sectionIdx],
      sentences: [...next[sectionIdx].sentences, ''],
    };
    setSections(next);
  };

  const totalSentences = sections.reduce(
    (sum, s) => sum + s.sentences.length,
    0,
  );

  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    const text = serializeToTsFormat(sections);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [sections]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-3xl mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-6">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              Edit: {group.name}
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              {totalSentences} sentences in {sections.length} sections
              {group.hasAdminOverride ? ' (admin override)' : ' (TS default)'}
              {group.isAdminCreated && ' (admin-created domain)'}
            </p>
            <Button
              onClick={handleCopy}
              variant="outline"
              size="sm"
              className="mt-2 gap-1.5"
            >
              <FileText size={14} />
              {copied ? 'Copied!' : 'Copy as TS format'}
            </Button>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg flex-shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        {/* Paste TS format to add/replace */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Paste from TS format (to add or replace sections)
          </label>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={`// ── New Section ──\n'Sentence one',\n'Sentence two',`}
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y font-mono"
            rows={3}
          />
          <Button
            onClick={handleParse}
            disabled={!rawText.trim()}
            variant="outline"
            size="sm"
            className="mt-2 gap-2"
          >
            <FileText size={14} />
            {saveMode === 'append' ? 'Append Parsed' : 'Replace with Parsed'}
          </Button>
        </div>

        {/* Sections */}
        <div className="mb-6 space-y-3 max-h-80 overflow-y-auto">
          {sections.map((sec, si) => (
            <SectionGroup
              key={si}
              title={sec.section}
              sentences={sec.sentences}
              onUpdateSentence={(i, v) => updateSectionSentence(si, i, v)}
              onRemoveSentence={(i) => removeSectionSentence(si, i)}
              onAddSentence={() => addSectionSentence(si)}
            />
          ))}
        </div>

        {/* Save mode selector */}
        <div className="mb-4 p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            <Layers size={16} className="inline mr-1" />
            Save Mode
          </label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="saveMode"
                value="replace"
                checked={saveMode === 'replace'}
                onChange={() => setSaveMode('replace')}
                className="text-blue-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                <strong>Replace</strong> — delete all existing, insert new
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="saveMode"
                value="append"
                checked={saveMode === 'append'}
                onChange={() => setSaveMode('append')}
                className="text-blue-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                <strong>Append</strong> — add to existing (deduplicate)
              </span>
            </label>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
          <Button onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button
            onClick={doSave}
            disabled={loading || totalSentences === 0}
            className="gap-2"
          >
            <Save size={16} />
            {loading
              ? 'Saving...'
              : `Save & Re-embed (${saveMode === 'append' ? 'Append' : 'Replace'})`}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Test Panel
// ============================================================
function TestPanel() {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<TestClassificationResponse | null>(null);

  const { run: doTest, loading } = useRequest(
    async () => {
      const res = await intentExamplesApi.testClassification({ input });
      return res;
    },
    {
      manual: true,
      onSuccess: (res) => {
        setResult(res);
      },
    },
  );

  return (
    <section className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <TestTube size={18} className="text-purple-500" />
          Test Classification
        </h3>
      </div>
      <div className="p-5 space-y-4">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && input.trim()) {
                doTest();
              }
            }}
            placeholder="Type a user message to test intent classification..."
            className="flex-1 px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <Button
            onClick={() => doTest()}
            disabled={loading || !input.trim()}
            className="gap-2"
          >
            <TestTube size={16} />
            {loading ? 'Classifying...' : 'Test'}
          </Button>
        </div>

        {result && (
          <div className="space-y-3">
            {/* Primary intent */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50">
              <Sparkles
                size={20}
                className={
                  result.method === 'embedding'
                    ? 'text-green-500'
                    : 'text-yellow-500'
                }
              />
              <div>
                <span className="text-sm text-gray-500">Primary Intent:</span>
                <span
                  className={cn(
                    'ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                    getDomainColor(result.intent),
                  )}
                >
                  {result.intent}
                </span>
                <span className="ml-2 text-xs text-gray-400">
                  (method: {result.method})
                </span>
              </div>
            </div>

            {/* All labels */}
            {result.labels.length > 0 && (
              <div>
                <span className="text-sm text-gray-500 mb-2 block">
                  All Labels:
                </span>
                <div className="flex flex-wrap gap-2">
                  {result.labels.map((l) => (
                    <span
                      key={l.label}
                      className={cn(
                        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                        getDomainColor(l.label),
                      )}
                    >
                      {l.label}: {l.score.toFixed(2)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Raw TOP-5 */}
            {result.rawTop5 && result.rawTop5.length > 0 && (
              <div>
                <span className="text-sm text-gray-500 mb-2 block">
                  Raw TOP-5 (pgvector):
                </span>
                <div className="space-y-1">
                  {result.rawTop5.map((r, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-sm font-mono"
                    >
                      <span className="text-gray-400 w-4">{i + 1}.</span>
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded text-xs font-medium',
                          getDomainColor(r.domain),
                        )}
                      >
                        {r.domain}
                      </span>
                      <span className="text-gray-500">
                        similarity={r.similarity.toFixed(4)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// ============================================================
// Helper: merge sections (for append mode)
// ============================================================
function mergeSections(
  existing: ParsedSection[],
  incoming: ParsedSection[],
): ParsedSection[] {
  const map = new Map<string, string[]>();
  for (const s of existing) {
    map.set(s.section, [...s.sentences]);
  }
  for (const s of incoming) {
    const existingSentences = map.get(s.section) ?? [];
    const set = new Set(existingSentences);
    for (const sentence of s.sentences) {
      if (!set.has(sentence)) {
        existingSentences.push(sentence);
        set.add(sentence);
      }
    }
    map.set(s.section, existingSentences);
  }
  return Array.from(map.entries()).map(([section, sentences]) => ({
    section,
    sentences,
  }));
}

// ============================================================
// Main Component
// ============================================================
export function IntentExamplesClient() {
  const [groups, setGroups] = useState<IntentExampleGroup[]>([]);
  const [editing, setEditing] = useState<IntentExampleGroup | null>(null);
  const [creating, setCreating] = useState(false);
  const [reindexing, setReindexing] = useState<string | null>(null);

  const { run: fetchData, loading } = useRequest(
    async () => {
      const data = await intentExamplesApi.getAll();
      setGroups(data);
    },
    { manual: false },
  );

  const { run: doReindex } = useRequest(
    async (domain: string) => {
      setReindexing(domain);
      await intentExamplesApi.reindexDomain(domain);
    },
    {
      manual: true,
      onSuccess: () => {
        setReindexing(null);
        fetchData();
      },
      onError: () => {
        setReindexing(null);
      },
    },
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Intent Examples"
        description="Manage example sentences used for intent classification. Changes trigger automatic re-embedding."
      />

      {/* Test Panel */}
      <TestPanel />

      {/* Domain List */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Sparkles size={18} className="text-blue-500" />
            Domains ({groups.length})
          </h3>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setCreating(true)}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              <Plus size={14} />
              Create Domain
            </Button>
            <Button
              onClick={fetchData}
              disabled={loading}
              variant="ghost"
              size="sm"
              className="gap-2"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </Button>
          </div>
        </div>

        {loading && groups.length === 0 ? (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        ) : groups.length === 0 ? (
          <div className="p-8 text-center text-gray-400">No domains found</div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {groups.map((group) => (
              <div
                key={group.name}
                className="px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: Domain info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={cn(
                          'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                          getDomainColor(group.name),
                        )}
                      >
                        {group.name}
                      </span>
                      {group.hasAdminOverride && (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                          <CheckCircle2 size={12} />
                          Admin override
                        </span>
                      )}
                      {group.isAdminCreated && (
                        <span className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                          <Sparkles size={12} />
                          Admin-created
                        </span>
                      )}
                      {group.requiredTags && group.requiredTags.length > 0 && (
                        <span className="text-xs text-gray-400">
                          tags: {group.requiredTags.join(', ')}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 line-clamp-2">
                      {group.examples.slice(0, 3).join(' | ')}
                      {group.examples.length > 3 && (
                        <span className="text-gray-400">
                          {' '}
                          ... and {group.examples.length - 3} more
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      {group.examples.length} sentences
                      {group.sections && group.sections.length > 0 && (
                        <> · {group.sections.length} sections</>
                      )}
                      {group.updatedAt && (
                        <>
                          {' '}
                          · Last updated:{' '}
                          {new Date(group.updatedAt).toLocaleString()}
                        </>
                      )}
                    </p>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      onClick={() => setEditing(group)}
                      variant="outline"
                      size="sm"
                    >
                      Edit
                    </Button>
                    <Button
                      onClick={() => doReindex(group.name)}
                      disabled={reindexing === group.name}
                      variant="ghost"
                      size="sm"
                      className="gap-1.5"
                    >
                      <RefreshCw
                        size={14}
                        className={
                          reindexing === group.name ? 'animate-spin' : ''
                        }
                      />
                      Re-index
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Create Modal */}
      {creating && (
        <CreateModal onClose={() => setCreating(false)} onSaved={fetchData} />
      )}

      {/* Edit Modal */}
      {editing && (
        <EditModal
          group={editing}
          onClose={() => setEditing(null)}
          onSaved={fetchData}
        />
      )}
    </div>
  );
}
