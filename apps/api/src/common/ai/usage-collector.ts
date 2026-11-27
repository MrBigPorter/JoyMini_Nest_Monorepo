/**
 * 评测用量采集器（eval-ingestion-hardening D5）。
 *
 * 为什么要 callback 而不是读返回值：LangChain 的链在 invoke 后只交出模型正文，
 * `usage_metadata` 会随消息对象一起丢掉。callback 的 `handleLLMEnd` 拿到的是
 * 原始 LLMResult，是 provider 用量能到达的唯一位置。
 *
 * 三档口径（缺一档就会把「没数据」伪装成「0 token」）：
 *   1. 消息 `usage_metadata`（ChatOpenAI / streamUsage 的常规位置）；
 *   2. `llmOutput.tokenUsage`（OpenAI 兼容接口的老字段）；
 *   3. 两者都没有 → 记一次「不可得调用」，token 保持 0 但调用数照记。
 *
 * 失败调用同样计调用数：判官三次尝试里有一次 4xx，账上必须能看出「调了 3 次」，
 * 只是 token 只来自成功的那几次。
 */

export type UsageRole = 'chat' | 'judge';

export interface LlmTokenCounts {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmUsageSnapshot extends LlmTokenCounts {
  role: UsageRole;
  /** 尝试过的 LLM 调用次数（含失败）。 */
  calls: number;
  /** 拿到了 provider 用量的调用次数。 */
  measuredCalls: number;
  /** 没拿到用量的调用次数（provider 未返回或调用失败）。 */
  unavailableCalls: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function toTokens(value: unknown): number {
  return isFiniteNumber(value) ? value : 0;
}

/**
 * 从一次 LLMResult 里读用量；读不到返回 null（不可得），绝不返回全 0 冒充。
 */
export function readLlmUsage(output: unknown): LlmTokenCounts | null {
  const result = output as {
    generations?: Array<Array<{ message?: { usage_metadata?: unknown } }>>;
    llmOutput?: { tokenUsage?: unknown };
  } | null;

  const metadata = result?.generations?.[0]?.[0]?.message?.usage_metadata as
    | Record<string, unknown>
    | undefined;
  if (
    metadata &&
    (isFiniteNumber(metadata.input_tokens) ||
      isFiniteNumber(metadata.output_tokens))
  ) {
    const promptTokens = toTokens(metadata.input_tokens);
    const completionTokens = toTokens(metadata.output_tokens);
    return {
      promptTokens,
      completionTokens,
      totalTokens: isFiniteNumber(metadata.total_tokens)
        ? metadata.total_tokens
        : promptTokens + completionTokens,
    };
  }

  const tokenUsage = result?.llmOutput?.tokenUsage as
    | Record<string, unknown>
    | undefined;
  if (
    tokenUsage &&
    (isFiniteNumber(tokenUsage.promptTokens) ||
      isFiniteNumber(tokenUsage.completionTokens))
  ) {
    const promptTokens = toTokens(tokenUsage.promptTokens);
    const completionTokens = toTokens(tokenUsage.completionTokens);
    return {
      promptTokens,
      completionTokens,
      totalTokens: isFiniteNumber(tokenUsage.totalTokens)
        ? tokenUsage.totalTokens
        : promptTokens + completionTokens,
    };
  }

  return null;
}

/**
 * 单角色 collector。一个判官调用（含多次尝试）共享一个实例，
 * 多次尝试由此自然求和；不同角色用不同实例，便于按角色分账。
 */
export class LlmUsageCollector {
  /**
   * 必须自带 name：LangChain 的 ensureHandler 对无 name 的对象走
   * `Object.assign(this, methods)` 包装，只复制自有属性，
   * 原型上的 handleLLMEnd 会整条丢掉（用量永远记不上）。
   */
  readonly name = 'eval-usage-collector';
  private calls = 0;
  private measuredCalls = 0;
  private unavailableCalls = 0;
  private promptTokens = 0;
  private completionTokens = 0;
  private totalTokens = 0;

  constructor(readonly role: UsageRole) {}

  handleLLMEnd(output: unknown): void {
    this.calls += 1;
    const usage = safeReadUsage(output);
    if (!usage) {
      this.unavailableCalls += 1;
      return;
    }
    this.measuredCalls += 1;
    this.promptTokens += usage.promptTokens;
    this.completionTokens += usage.completionTokens;
    this.totalTokens += usage.totalTokens;
  }

  // LangChain 会传 (error, runId)，本采集器只关心次数，签名保持兼容。
  handleLLMError(_error?: unknown): void {
    this.calls += 1;
    this.unavailableCalls += 1;
  }

  snapshot(): LlmUsageSnapshot {
    return {
      role: this.role,
      calls: this.calls,
      measuredCalls: this.measuredCalls,
      unavailableCalls: this.unavailableCalls,
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      totalTokens: this.totalTokens,
    };
  }
}

/** 空账本：运行开始时按角色初始化。 */
export function emptyUsageSnapshot(role: UsageRole): LlmUsageSnapshot {
  return {
    role,
    calls: 0,
    measuredCalls: 0,
    unavailableCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
}

/**
 * 把一次判定/一次聊天的用量并入运行账本。
 * 没有快照（该用例没调判官、或调用前就失败）是空操作，不能当成 0 调用。
 */
export function addUsageSnapshot(
  target: LlmUsageSnapshot,
  value?: LlmUsageSnapshot | null,
): void {
  if (!value) return;
  target.calls += value.calls;
  target.measuredCalls += value.measuredCalls;
  target.unavailableCalls += value.unavailableCalls;
  target.promptTokens += value.promptTokens;
  target.completionTokens += value.completionTokens;
  target.totalTokens += value.totalTokens;
}

/** 回调里的异常若冒泡会打断模型链，所以读取本身兜底。 */
function safeReadUsage(output: unknown): LlmTokenCounts | null {
  try {
    return readLlmUsage(output);
  } catch {
    return null;
  }
}
