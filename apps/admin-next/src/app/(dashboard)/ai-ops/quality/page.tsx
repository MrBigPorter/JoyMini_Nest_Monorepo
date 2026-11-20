'use client';

import { useState } from 'react';
import { useRequest } from 'ahooks';
import { Button } from '@repo/ui';
import { aiQualityApi, chatApi, knowledgeApi } from '@/api';
import { PageHeader } from '@/components/scaffold/PageHeader';
import type { EvalDataset, EvalRun } from '@/type/types';

type Tab = 'feedback' | 'eval' | 'rag';

export default function AiQualityPage() {
  const [tab, setTab] = useState<Tab>('feedback');

  return (
    <div className="space-y-5 p-4">
      <PageHeader
        title="AI Quality"
        description="反馈分诊、评测集与批量跑分、RAG 检索质量"
      />
      <div className="flex gap-2 border-b pb-2 dark:border-white/10">
        {[
          ['feedback', 'Feedback'],
          ['eval', 'Eval Datasets'],
          ['rag', 'RAG Quality'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key as Tab)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              tab === key
                ? 'bg-blue-600 text-white'
                : 'border dark:border-white/10'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'feedback' ? <FeedbackPanel /> : null}
      {tab === 'eval' ? <EvalPanel /> : null}
      {tab === 'rag' ? <RagPanel /> : null}
    </div>
  );
}

function FeedbackPanel() {
  const [reviewStatus, setReviewStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, refresh } = useRequest(
    () =>
      chatApi.getFeedbackList({
        page,
        pageSize: 20,
        ...(reviewStatus ? { reviewStatus } : {}),
      } as any),
    { refreshDeps: [page, reviewStatus] },
  );
  const list = (data as any)?.list ?? [];
  const total = (data as any)?.total ?? 0;

  const triage = async (id: string, status: 'REVIEWED' | 'IGNORED') => {
    const note = window.prompt('备注（可选）') ?? undefined;
    await aiQualityApi.updateFeedback(id, { reviewStatus: status, note });
    await refresh();
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <select
          className="rounded-lg border px-3 py-1.5 text-sm dark:border-white/10 dark:bg-gray-800"
          value={reviewStatus}
          onChange={(e) => {
            setReviewStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All status</option>
          <option value="PENDING">PENDING</option>
          <option value="REVIEWED">REVIEWED</option>
          <option value="IGNORED">IGNORED</option>
        </select>
        <Button size="sm" variant="outline" onClick={refresh}>
          刷新
        </Button>
        <span className="text-xs text-gray-500">Total {total}</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left dark:bg-white/5">
            <tr>
              {[
                'Time',
                'Source',
                'Verdict/Signal',
                'Review',
                'Note',
                'Actions',
              ].map((h) => (
                <th key={h} className="px-3 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-gray-400">
                  Loading...
                </td>
              </tr>
            )}
            {!loading && list.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-gray-400">
                  暂无反馈
                </td>
              </tr>
            )}
            {list.map((item: any) => (
              <tr
                key={item.id}
                className="border-t border-gray-100 dark:border-white/5"
              >
                <td className="px-3 py-2">
                  {new Date(item.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-2">{item.source}</td>
                <td className="px-3 py-2">
                  {item.verdict ?? item.signal ?? '-'}
                </td>
                <td className="px-3 py-2">{item.reviewStatus}</td>
                <td
                  className="max-w-[220px] truncate px-3 py-2"
                  title={item.note ?? ''}
                >
                  {item.note ?? '-'}
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => triage(item.id, 'REVIEWED')}
                    >
                      Reviewed
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => triage(item.id, 'IGNORED')}
                    >
                      Ignore
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Prev
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={page * 20 >= total}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </section>
  );
}

function EvalPanel() {
  const [name, setName] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [casesJson, setCasesJson] = useState('[]');
  const [runId, setRunId] = useState('');
  const [message, setMessage] = useState('');

  const { data: datasets, refresh: refreshDatasets } = useRequest(
    aiQualityApi.listDatasets,
  );
  const { data: dataset, refresh: refreshDataset } = useRequest(
    () =>
      selectedId ? aiQualityApi.getDataset(selectedId) : Promise.resolve(null),
    { refreshDeps: [selectedId] },
  );
  const { data: run } = useRequest(
    () => (runId ? aiQualityApi.getRun(runId) : Promise.resolve(null)),
    { refreshDeps: [runId], pollingInterval: runId ? 3000 : undefined },
  );

  const create = async () => {
    if (!name.trim()) return;
    try {
      const created = await aiQualityApi.createDataset({ name: name.trim() });
      setName('');
      await refreshDatasets();
      setSelectedId(created.id);
    } catch (err: any) {
      setMessage(err?.message ?? '创建失败');
    }
  };

  const addCases = async () => {
    if (!selectedId) return;
    try {
      const parsed = JSON.parse(casesJson);
      if (!Array.isArray(parsed)) throw new Error('JSON 必须是数组');
      await aiQualityApi.addCases(selectedId, { cases: parsed });
      setMessage(`已添加 ${parsed.length} 条用例`);
      await refreshDataset();
      await refreshDatasets();
    } catch (err: any) {
      setMessage(err?.message ?? '导入失败');
    }
  };

  const start = async () => {
    if (!selectedId) return;
    if (!window.confirm('确认启动批量评测？会调用 judge 模型。')) return;
    try {
      const created = await aiQualityApi.startRun(selectedId);
      setRunId(created.id);
      setMessage('已启动，轮询结果中...');
    } catch (err: any) {
      setMessage(err?.message ?? '启动失败');
    }
  };

  const ds = dataset as any;
  const runData = run as EvalRun | null;
  const list = (datasets as EvalDataset[] | undefined) ?? [];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="rounded-lg border px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-800"
          placeholder="新评测集名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button onClick={create}>创建评测集</Button>
        <select
          className="rounded-lg border px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-800"
          value={selectedId}
          onChange={(e) => {
            setSelectedId(e.target.value);
            setRunId('');
          }}
        >
          <option value="">选择评测集</option>
          {list.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({d._count?.cases ?? 0} cases)
            </option>
          ))}
        </select>
      </div>
      {message ? (
        <div className="text-sm text-gray-600 dark:text-gray-300">
          {message}
        </div>
      ) : null}

      {selectedId ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
            <h3 className="mb-2 text-sm font-semibold">导入用例 (JSON 数组)</h3>
            <textarea
              className="h-40 w-full rounded-lg border p-2 font-mono text-xs dark:border-white/10 dark:bg-gray-800"
              value={casesJson}
              onChange={(e) => setCasesJson(e.target.value)}
            />
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={addCases}>
                导入
              </Button>
              <Button size="sm" variant="outline" onClick={start}>
                启动批量评测
              </Button>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              每条格式：
              {`{"question":"...","answer":"...","expect":{"mustMention":["..."]}}`}
            </p>
          </div>

          <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
            <h3 className="mb-2 text-sm font-semibold">
              用例（{ds?.cases?.length ?? 0}）
            </h3>
            <div className="max-h-52 space-y-2 overflow-y-auto text-xs">
              {(ds?.cases ?? []).map((c: any) => (
                <div
                  key={c.id}
                  className="rounded-lg border p-2 dark:border-white/10"
                >
                  <div className="font-medium">{c.question}</div>
                  <div className="text-gray-500">{c.answer}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {runData ? (
        <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
          <h3 className="mb-2 text-sm font-semibold">
            Run {runData.id} · {runData.status} ·{' '}
            {JSON.stringify(runData.summary ?? {})}
          </h3>
          <div className="space-y-2 text-xs">
            {(runData.results ?? []).map((r) => (
              <div
                key={r.id}
                className="rounded-lg border p-2 dark:border-white/10"
              >
                <div className="font-medium">
                  {r.verdict} · score {r.score} · {r.latencyMs ?? '-'}ms
                </div>
                <div>{r.case?.question}</div>
                <div className="text-gray-500">{r.reason}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function RagPanel() {
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const { data: stats } = useRequest(() => knowledgeApi.qualityStats());

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      setResult(
        await aiQualityApi.ragSearch({
          query: query.trim(),
          ...(domain ? { domain } : {}),
          topK: 5,
          debug: true,
        }),
      );
    } catch (err: any) {
      setResult({ error: err?.message ?? '检索失败' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {Object.entries((stats as any) ?? {}).map(([k, v]) => (
          <div key={k} className="rounded-xl border p-3 dark:border-white/10">
            <div className="text-xs text-gray-500">{k}</div>
            <div className="text-lg font-semibold">
              {typeof v === 'number' ? v : '-'}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          className="min-w-[280px] rounded-lg border px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-800"
          placeholder="检索问题"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <input
          className="rounded-lg border px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-800"
          placeholder="domain（可选）"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
        />
        <Button onClick={search} disabled={loading}>
          {loading ? 'Retrieving...' : '检索'}
        </Button>
      </div>
      <pre className="max-h-[420px] overflow-auto rounded-xl border bg-gray-50 p-3 text-xs dark:border-white/10 dark:bg-gray-900">
        {JSON.stringify(result, null, 2)}
      </pre>
    </section>
  );
}
