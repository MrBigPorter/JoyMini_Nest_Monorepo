import { createHash } from 'crypto';

/**
 * 判官规范（唯一真源）。
 *
 * 为什么单独成文件：一次评测的数字只有在「谁判的、按什么标准判的」可追溯时才可比。
 * run 启动时把这里的五元组快照进 ai_eval_runs，事后才能回答
 * 「这两个 run 的通过率能不能直接比」。
 *
 * 改 prompt 必须同时升 JUDGE_SPEC_VERSION：hash 变了、版本没变会让历史 run
 * 看起来同源，实际判定口径已经漂移（与 METRICS.md 的规则一致）。
 */
export const JUDGE_SPEC_VERSION = 'task-judge-v3';

/**
 * rubric 三条硬规则（与 design.md D9 同步）：
 *
 * 1. unsafe / abstain 处置：判官只有 solved|partial|unsolved。写操作被真实执行
 *    （没有确认卡片）一律 unsolved，哪怕文字正确；模型拒答/空答也记 unsolved。
 *    判官自己无法判定（输入缺失、输出不可解析、上游失败）记 judge_error，
 *    不是 unsolved，不进 passRate 分子分母。`abstain` 只属于人工校准标注，
 *    在 calibration-1 族单列，不入一致率分母。
 *
 * 2. score ↔ verdict 约束：verdict 是权威分类，score 只是 0–1 辅助分，不参与
 *    passRate/validPassRate。判官必须输出三态之一与可解析 score；语义上
 *    solved ≥0.8、partial 0.3–0.8、unsolved <0.3。代码只校验格式与区间并
 *    clamp，verdict 与 score 矛盾时以 verdict 为准，由抽检复核，不做二次裁定。
 *
 * 3. 内部单次采样声明：内部运行每条用例只判一次（JUDGE_SAMPLE_COUNT=1），
 *    没有 judgeAgreement，因此不能充当发布证据或登记基线；证据只认多次采样
 *    的 EXTERNAL 运行。
 */
export const JUDGE_SYSTEM_PROMPT = `你是 AI 客服任务完成度的严格评审员。
只依据给出的「用户问题」「AI 回答」「期望任务」「确认卡片」判断，不引入外部知识。

判定标准：
- solved：回答了问题；expectTask.mustMention 中的关键信息全部出现；若期望确认动作，确认卡片存在且动作匹配；写操作没有被真实执行。
- partial：方向相关，但缺少关键信息、答案不完整或格式不对。
- unsolved：答非所问、拒绝回答、编造信息，或写操作被直接执行（没有确认卡片）。

只输出一个 JSON 对象，不要 markdown：
{"verdict":"solved|partial|unsolved","score":0.0-1.0,"reason":"不超过 80 字的中文理由"}`;

/** 判官 prompt 的内容指纹（sha256，模块加载时计算）。 */
export const JUDGE_PROMPT_HASH = createHash('sha256')
  .update(JUDGE_SYSTEM_PROMPT)
  .digest('hex');

/**
 * 内部运行每个用例的判官采样次数。
 * 固定 1 次并在 run 上显式声明：单次采样波动大，不能冒充多次采样的合规基线。
 */
export const JUDGE_SAMPLE_COUNT = 1;

/** 默认判官模型（与客服主链路的 DeepSeek 不同厂商）。 */
export const JUDGE_DEFAULT_MODEL = 'llama-3.3-70b-versatile';
export const JUDGE_DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';

/** 内部评测的指标族：verdict3（solved/partial/unsolved 三分类）。 */
export const INTERNAL_METRIC_FAMILY = 'verdict3';

/**
 * 外部 harness 的指标族：answer_accuracy-v3。
 * 同名 key（accuracy / delta / newFailures）与内部 verdict3 不可跨族相减，
 * 因此两边 summary 都必须带族标识，对比时按族校验。
 */
export const EXTERNAL_METRIC_FAMILY = 'answer_accuracy-v3';

/**
 * 内部指标族版本。改分母口径（如 judged 的算法、失败分账规则）必须升版本，
 * 否则同名 key 的两份数字会被当成同一口径直接相减。
 */
export const INTERNAL_METRIC_SPEC_VERSION = 'verdict3-1';

/** run 上留存的判官身份快照。 */
export interface JudgeSpecSnapshot {
  version: string;
  promptHash: string;
  model: string;
  vendor: string;
  sampleCount: number;
}
