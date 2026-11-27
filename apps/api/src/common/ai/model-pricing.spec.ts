import {
  DEFAULT_MODEL_PRICES,
  estimateRunCost,
  loadPriceTable,
} from './model-pricing';

/**
 * 价目表契约（eval-ingestion-hardening 5.3）：
 * 按模型取价 → 全局回退 → 缺价显式未配置；跨币种必须在有汇率时才可合计。
 */

describe('loadPriceTable', () => {
  it('默认价目表可用，模型名大小写不敏感', () => {
    const table = loadPriceTable({});

    expect(table.models.get('deepseek-chat')?.currency).toBe('USD');
    expect(table.models.get('llama-3.3-70b-versatile')?.outputPer1M).toBe(
      DEFAULT_MODEL_PRICES.find((p) => p.model === 'llama-3.3-70b-versatile')
        ?.outputPer1M,
    );
  });

  it('环境变量覆盖同名模型价格，并保留其它默认条目', () => {
    const table = loadPriceTable({
      AI_EVAL_MODEL_PRICES: JSON.stringify([
        {
          model: 'deepseek-chat',
          currency: 'USD',
          inputPer1M: 9,
          outputPer1M: 99,
        },
      ]),
    });

    expect(table.models.get('deepseek-chat')).toMatchObject({
      inputPer1M: 9,
      outputPer1M: 99,
    });
    expect(table.models.has('llama-3.3-70b-versatile')).toBe(true);
  });

  it('非法 JSON 不炸，回退到默认价目表', () => {
    const table = loadPriceTable({ AI_EVAL_MODEL_PRICES: 'not json' });

    expect(table.models.get('deepseek-chat')).toBeDefined();
  });

  it('保留全局回退（AI_PRICE_INPUT_PER_1M / AI_PRICE_OUTPUT_PER_1M）', () => {
    const table = loadPriceTable({
      AI_PRICE_INPUT_PER_1M: '1',
      AI_PRICE_OUTPUT_PER_1M: '2',
    });

    expect(table.global).toMatchObject({
      inputPer1M: 1,
      outputPer1M: 2,
      currency: 'USD',
    });
  });
});

describe('estimateRunCost', () => {
  const usage = {
    model: 'deepseek-chat',
    promptTokens: 1_000_000,
    completionTokens: 1_000_000,
  };

  it('命中：按模型单价计算并标记已配置', () => {
    const price = DEFAULT_MODEL_PRICES.find((p) => p.model === 'deepseek-chat')!;
    const table = loadPriceTable({});

    const result = estimateRunCost(table, [usage]);

    expect(result).toMatchObject({
      configured: true,
      currency: 'USD',
      cost: price.inputPer1M + price.outputPer1M,
      missingModels: [],
    });
  });

  it('缺模型且无全局回退：显式未配置，不补 0 当真', () => {
    const table = loadPriceTable({});

    const result = estimateRunCost(table, [
      { model: 'unknown-model', promptTokens: 10, completionTokens: 5 },
    ]);

    expect(result.configured).toBe(false);
    expect(result.cost).toBe(0);
    expect(result.currency).toBeNull();
    expect(result.missingModels).toEqual(['unknown-model']);
  });

  it('缺模型但有全局回退：用全局价（历史口径保留）', () => {
    const table = loadPriceTable({
      AI_PRICE_INPUT_PER_1M: '3',
      AI_PRICE_OUTPUT_PER_1M: '4',
    });

    const result = estimateRunCost(table, [
      { model: null, promptTokens: 1_000_000, completionTokens: 0 },
    ]);

    expect(result).toMatchObject({
      configured: true,
      currency: 'USD',
      cost: 3,
    });
  });

  it('环境覆盖后的价格参与计算', () => {
    const table = loadPriceTable({
      AI_EVAL_MODEL_PRICES: JSON.stringify([
        {
          model: 'deepseek-chat',
          currency: 'USD',
          inputPer1M: 10,
          outputPer1M: 20,
        },
      ]),
    });

    const result = estimateRunCost(table, [
      { model: 'deepseek-chat', promptTokens: 1_000_000, completionTokens: 0 },
    ]);

    expect(result.cost).toBe(10);
  });

  it('多币种且无汇率：拒绝合计并标记原因', () => {
    const table = loadPriceTable({
      AI_EVAL_MODEL_PRICES: JSON.stringify([
        { model: 'cny-model', currency: 'CNY', inputPer1M: 1, outputPer1M: 2 },
      ]),
    });

    const result = estimateRunCost(table, [
      usage,
      { model: 'cny-model', promptTokens: 1, completionTokens: 1 },
    ]);

    expect(result.configured).toBe(false);
    expect(result.currency).toBeNull();
    expect(result.unconvertedCurrencies).toEqual(['CNY']);
  });

  it('多币种配置汇率后可折算为 USD', () => {
    const table = loadPriceTable({
      AI_EVAL_MODEL_PRICES: JSON.stringify([
        { model: 'cny-model', currency: 'CNY', inputPer1M: 10, outputPer1M: 0 },
      ]),
      AI_PRICE_FX_JSON: JSON.stringify({ CNY: 0.14 }),
    });

    const result = estimateRunCost(table, [
      { model: 'cny-model', promptTokens: 1_000_000, completionTokens: 0 },
    ]);

    expect(result.configured).toBe(true);
    expect(result.currency).toBe('USD');
    expect(result.cost).toBeCloseTo(1.4, 6);
  });

  it('没有可计价的用量：未配置而不是 0 成本', () => {
    const result = estimateRunCost(loadPriceTable({}), []);

    expect(result.configured).toBe(false);
    expect(result.cost).toBe(0);
  });
});
