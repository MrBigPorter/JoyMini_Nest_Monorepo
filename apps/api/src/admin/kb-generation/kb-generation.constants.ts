/** 121-M1：知识库候选生成队列与开关 */

export const KB_GENERATION_QUEUE = 'kb-generation';
export const KB_GENERATION_JOB = 'generate';
export const KB_GENERATION_PROMPT_VERSION = 'kb-gen-v1';

/**
 * 满足什么条件把候选标成「重点复核」。
 *
 * 只按近重复风险判定：与同域已有示例的余弦相似度够高，说明它和存量几乎同义，
 * 批准后只是重复计数。不能再按 kind 判定（`kind !== 'KEYWORD'`）——那样每条
 * 示例都带徽标，批次批准时又默认跳过带徽标的，等于批量审核永远批不动。
 */
export const KB_NEEDS_REVIEW_SIMILARITY = 0.85;

/** 默认关闭；灰度时显式打开。关闭不影响发布与检索。 */
export function isKbGenerationEnabled(): boolean {
  return process.env.KB_GENERATION_ENABLED === 'true';
}

/** M2a：关键词自动生效默认关闭，灰度时显式打开 */
export function isKeywordAutoApplyEnabled(): boolean {
  return process.env.KB_KEYWORD_AUTO_APPLY === 'true';
}

export function keywordAutoApplyLimits() {
  const int = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    /** 单文档 keywords ∪ autoKeywords 的总上限 */
    maxTotal: int(process.env.KB_KEYWORD_MAX_TOTAL, 20),
    maxLength: 64,
    minLength: 2,
    /** 回滚窗口（天） */
    rollbackDays: int(process.env.KB_KEYWORD_ROLLBACK_DAYS, 30),
    /** Meili 写入失败后，补偿任务最早多少分钟重试 */
    retryAfterMinutes: 10,
  };
}

export function generationLimits() {
  const int = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    maxKeywords: int(process.env.KB_MAX_KEYWORDS_PER_DOC, 8),
    maxExamples: int(process.env.KB_MAX_EXAMPLES_PER_DOC, 4),
    maxGoldenQueries: int(process.env.KB_MAX_GOLDEN_PER_DOC, 5),
    hourlyLimit: int(process.env.KB_GENERATION_HOURLY_LIMIT, 50),
    contentMaxChars: int(process.env.KB_GENERATION_CONTENT_CHARS, 6000),
  };
}
