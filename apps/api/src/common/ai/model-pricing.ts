/**
 * 评测成本价目表（eval-ingestion-hardening 5.3）。
 *
 * 为什么不是「一个全局单价」：聊天与判官用的模型不同、计价币种可能不同，
 * 混用一个数字算出来的成本既不可解释也无法核对。
 *
 * 取价顺序：模型名精确命中 → 全局回退（AI_PRICE_INPUT_PER_1M /
 * AI_PRICE_OUTPUT_PER_1M，保留历史口径）→ 缺价显式未配置。
 * 缺价与无法折算的币种都不会被当成 0 计算：宁可不给数字，也不给假数字。
 */

export interface ModelPriceEntry {
  /** 模型名（小写归一），'*' 仅用于全局回退条目。 */
  model: string;
  /** 计价币种，大写 ISO 代码。 */
  currency: string;
  /** 每百万输入 token 的单价。 */
  inputPer1M: number;
  /** 每百万输出 token 的单价。 */
  outputPer1M: number;
}

export interface PriceTable {
  models: Map<string, ModelPriceEntry>;
  /** 全局回退价（模型缺价时使用），未配置为 null。 */
  global: ModelPriceEntry | null;
  /** 币种 → 折美元汇率。 */
  fxToUsd: Map<string, number>;
}

export interface CostedUsage {
  /** 实际使用的模型名；未知时为 null（走全局回退）。 */
  model: string | null;
  promptTokens: number;
  completionTokens: number;
}

export interface RunCostEstimate {
  /** 有可计价用量且无缺价/缺汇率时为 true。 */
  configured: boolean;
  /** 折算后的计价币种；未配置时为 null。 */
  currency: string | null;
  cost: number;
  /** 找不到价格的模型名（去重）。 */
  missingModels: string[];
  /** 有价格但缺汇率、无法折算到 USD 的币种（去重）。 */
  unconvertedCurrencies: string[];
}

/**
 * 内置默认价目表（USD / 每百万 token）。
 * 单价随供应商调价而变，环境变量 AI_EVAL_MODEL_PRICES 可覆盖同名条目，
 * 也可新增模型；未覆盖的默认条目继续生效。
 */
export const DEFAULT_MODEL_PRICES: readonly ModelPriceEntry[] = Object.freeze([
  // DeepSeek V3（deepseek-chat）：输入 $0.27、输出 $1.10。
  { model: 'deepseek-chat', currency: 'USD', inputPer1M: 0.27, outputPer1M: 1.1 },
  // Groq llama-3.3-70b-versatile：输入 $0.59、输出 $0.79。
  {
    model: 'llama-3.3-70b-versatile',
    currency: 'USD',
    inputPer1M: 0.59,
    outputPer1M: 0.79,
  },
]);

function normalizeModel(model: string): string {
  return model.trim().toLowerCase();
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parsePriceEntries(raw: unknown): ModelPriceEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: ModelPriceEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.model !== 'string' || !candidate.model.trim()) continue;
    if (
      !isPositiveNumber(candidate.inputPer1M) ||
      !isPositiveNumber(candidate.outputPer1M)
    ) {
      continue;
    }
    entries.push({
      model: normalizeModel(candidate.model),
      currency:
        typeof candidate.currency === 'string' && candidate.currency.trim()
          ? candidate.currency.trim().toUpperCase()
          : 'USD',
      inputPer1M: candidate.inputPer1M,
      outputPer1M: candidate.outputPer1M,
    });
  }
  return entries;
}

function safeJson(raw: string | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    // 配置写坏了按未配置处理：用默认价目表跑，好过整条评测链报错。
    return undefined;
  }
}

function numberFromEnv(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 构建价目表。默认条目先铺底，环境变量按模型名覆盖或追加。
 */
export function loadPriceTable(
  env: Record<string, string | undefined>,
): PriceTable {
  const models = new Map<string, ModelPriceEntry>();
  for (const entry of DEFAULT_MODEL_PRICES) {
    models.set(entry.model, entry);
  }
  for (const entry of parsePriceEntries(safeJson(env.AI_EVAL_MODEL_PRICES))) {
    models.set(entry.model, entry);
  }

  const inputPer1M = numberFromEnv(env.AI_PRICE_INPUT_PER_1M);
  const outputPer1M = numberFromEnv(env.AI_PRICE_OUTPUT_PER_1M);
  const globalConfigured =
    (inputPer1M !== null && inputPer1M > 0) ||
    (outputPer1M !== null && outputPer1M > 0);
  const global: ModelPriceEntry | null = globalConfigured
    ? {
        model: '*',
        currency: (env.AI_PRICE_CURRENCY || 'USD').trim().toUpperCase(),
        inputPer1M: Math.max(inputPer1M ?? 0, 0),
        outputPer1M: Math.max(outputPer1M ?? 0, 0),
      }
    : null;

  const fxToUsd = new Map<string, number>();
  const fxRaw = safeJson(env.AI_PRICE_FX_JSON);
  if (fxRaw && typeof fxRaw === 'object' && !Array.isArray(fxRaw)) {
    for (const [currency, rate] of Object.entries(
      fxRaw as Record<string, unknown>,
    )) {
      if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
        fxToUsd.set(currency.trim().toUpperCase(), rate);
      }
    }
  }

  return { models, global, fxToUsd };
}

function resolvePriceEntry(
  table: PriceTable,
  model: string | null,
): ModelPriceEntry | null {
  if (model) {
    const hit = table.models.get(normalizeModel(model));
    if (hit) return hit;
  }
  return table.global;
}

/**
 * 按用量估算运行成本（折算为 USD）。
 *
 * 任一用量缺价或币种缺汇率时整体返回「未配置」：部分合计会让读者以为
 * 那是全部成本，比不给数字更容易误导。缺 token 的用量不参与计价。
 */
export function estimateRunCost(
  table: PriceTable,
  usages: readonly CostedUsage[],
): RunCostEstimate {
  const missingModels = new Set<string>();
  const unconvertedCurrencies = new Set<string>();
  let total = 0;
  let pricedUsages = 0;

  for (const usage of usages) {
    if (usage.promptTokens <= 0 && usage.completionTokens <= 0) continue;

    const entry = resolvePriceEntry(table, usage.model);
    if (!entry) {
      missingModels.add(usage.model ?? 'default');
      continue;
    }

    const rate =
      entry.currency === 'USD' ? 1 : table.fxToUsd.get(entry.currency);
    if (!rate) {
      unconvertedCurrencies.add(entry.currency);
      continue;
    }

    total +=
      ((usage.promptTokens / 1_000_000) * entry.inputPer1M +
        (usage.completionTokens / 1_000_000) * entry.outputPer1M) *
      rate;
    pricedUsages += 1;
  }

  const configured =
    pricedUsages > 0 &&
    missingModels.size === 0 &&
    unconvertedCurrencies.size === 0;

  return {
    configured,
    currency: configured ? 'USD' : null,
    cost: configured ? total : 0,
    missingModels: [...missingModels],
    unconvertedCurrencies: [...unconvertedCurrencies],
  };
}
