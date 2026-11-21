/**
 * 极简 Prometheus 指标注册表（零依赖）
 *
 * 只支持 counter / gauge，够覆盖当前 AI 链路的四类信号：
 *   请求结果、token 用量、工具调用、活跃流。
 * 单实例进程内计数，重启归零；多实例时需要改为 Prometheus 聚合或 Redis。
 */

type MetricType = 'counter' | 'gauge';

interface MetricDef {
  help: string;
  type: MetricType;
  /** true 表示这个指标按标签分 series；无数据时不要输出裸 0。 */
  labeled: boolean;
  values: Map<string, number>;
}

const defs = new Map<string, MetricDef>();

function escapeLabel(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function labelKey(labels: Record<string, string> = {}): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return '';
  return `{${entries
    .map(([key, value]) => `${key}="${escapeLabel(value)}"`)
    .join(',')}}`;
}

function getDef(name: string): MetricDef {
  const def = defs.get(name);
  if (!def) throw new Error(`Metric "${name}" is not registered`);
  return def;
}

export function registerMetric(
  name: string,
  help: string,
  type: MetricType,
  labeled = false,
): void {
  if (!defs.has(name)) {
    defs.set(name, { help, type, labeled, values: new Map() });
  }
}

export function incCounter(
  name: string,
  labels: Record<string, string> = {},
  amount = 1,
): void {
  const def = getDef(name);
  if (def.type !== 'counter') {
    throw new Error(`Metric "${name}" is not a counter`);
  }
  const key = labelKey(labels);
  def.values.set(key, (def.values.get(key) ?? 0) + amount);
}

export function incGauge(
  name: string,
  labels: Record<string, string> = {},
  amount = 1,
): void {
  const def = getDef(name);
  if (def.type !== 'gauge') {
    throw new Error(`Metric "${name}" is not a gauge`);
  }
  const key = labelKey(labels);
  def.values.set(key, (def.values.get(key) ?? 0) + amount);
}

export function decGauge(
  name: string,
  labels: Record<string, string> = {},
  amount = 1,
): void {
  incGauge(name, labels, -amount);
}

export function setGauge(
  name: string,
  labels: Record<string, string> = {},
  value = 0,
): void {
  const def = getDef(name);
  if (def.type !== 'gauge') {
    throw new Error(`Metric "${name}" is not a gauge`);
  }
  def.values.set(labelKey(labels), value);
}

/** 渲染成 Prometheus 文本格式。 */
export function renderMetrics(): string {
  const lines: string[] = [];

  for (const [name, def] of [...defs.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    lines.push(`# HELP ${name} ${def.help}`);
    lines.push(`# TYPE ${name} ${def.type}`);

    if (def.values.size === 0) {
      // 无标签指标输出 0，方便 Prometheus 立刻看到；
      // 带标签的指标在出现第一个 series 前不输出裸 0，避免污染 label 维度。
      if (!def.labeled) lines.push(`${name} 0`);
      continue;
    }

    for (const [labels, value] of [...def.values.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      lines.push(`${name}${labels} ${value}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

/** 仅供测试：清空所有指标值（保留注册定义）。 */
export function resetMetricsForTest(): void {
  for (const def of defs.values()) def.values.clear();
}

// ── 预注册 AI 链路核心指标 ──
registerMetric(
  'ai_chat_requests_total',
  'AI chat requests by outcome (success/error/aborted/quota_exceeded)',
  'counter',
  true,
);
registerMetric(
  'ai_chat_duration_ms_total',
  'Total AI chat duration in milliseconds',
  'counter',
);
registerMetric('ai_active_streams', 'Currently active AI streams', 'gauge');
registerMetric(
  'ai_llm_tokens_total',
  'LLM tokens by type (prompt/completion/total)',
  'counter',
  true,
);
registerMetric(
  'ai_tool_calls_total',
  'AI tool calls by tool name',
  'counter',
  true,
);
registerMetric(
  'ai_retrieval_requests_total',
  'RAG retrieval requests by domain',
  'counter',
  true,
);
registerMetric(
  'support_queue_waiting',
  'Support conversations waiting for a human',
  'gauge',
);
registerMetric(
  'support_sla_breaches',
  'Support conversations past the SLA threshold',
  'gauge',
);
registerMetric(
  'ai_queue_jobs_failed_total',
  'AI processing jobs that failed (retry or dead-letter)',
  'counter',
  true,
);
registerMetric(
  'ai_trace_recorded_total',
  'AI trace recording outcomes (path=reply/error, result=ok/skipped/error)',
  'counter',
  true,
);
registerMetric(
  'ai_action_total',
  'AI write-action lifecycle events by action and result (created/confirmed/executed/failed/cancelled/expired)',
  'counter',
  true,
);
registerMetric(
  'withdraw_otp_missing_total',
  'Withdraw applications accepted without OTP while WITHDRAW_OTP_ENFORCE is off',
  'counter',
);
registerMetric(
  'handoff_escalations_total',
  'AI-to-human handoff attempts by reason and path (online/offline/fallback)',
  'counter',
  true,
);
registerMetric(
  'handoff_returns_total',
  'Conversations returned from human to AI by reason',
  'counter',
  true,
);
setGauge('ai_active_streams', {}, 0);
setGauge('support_queue_waiting', {}, 0);
setGauge('support_sla_breaches', {}, 0);
