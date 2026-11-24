import { Logger } from '@nestjs/common';
import { HANDOFF_REPLY_TEXTS } from '@api/client/ai-customer/ai-failure-handler';
import { KNOWLEDGE_CONSULT_INTENTS } from './knowledge-fallback';

/**
 * 依据门禁开关 —— 三态，默认 shadow。
 *
 * ── 为什么默认不是 enforce ──
 * 「无依据」是从运行时记录推断出来的，推断规则一定会有误判。直接上线
 * enforce 会把合法的澄清追问也换成转人工，用户感知是「AI 突然变笨」。
 * shadow 阶段只记录决定、不改回复，用一轮真实账号验收核对误降级比例，
 * 通过后再切 enforce。
 *
 * ── 回滚 ──
 * 把环境变量改成 `shadow` 或 `off` 重启即可，不需要回滚代码。
 * - off：门禁完全不运行，不写决定日志（最省事，用于紧急止血）
 * - shadow：运行并记录 groundingGateDecision，但不改回复
 * - enforce：degrade 决定真正替换回复并转人工
 *
 * 非法值（拼错、空串）回落 `shadow` 并告警：宁可少拦一轮，也不要
 * 因为一个拼写错误让门禁永久失效或永久生效。
 *
 * ── shadow → enforce 的切换条件（design D6）──
 * 1. shadow 跑完一轮真实账号全量验收（`node tools/eval/e2e/run.mjs`）；
 * 2. 报告里的 `groundingGateDecision` 分布中，degrade 用例逐条人工复核，
 *    误降级（正常回答/澄清被拦）可接受，且无依据作答率确实下降；
 * 3. 才把 `AI_GROUNDING_GATE=enforce` 写进部署环境变量，**不发版**。
 *
 * 验收结论落在 `openspec/changes/ai-answer-grounding/tasks.md` 6.1/6.2；
 * 未通过时保持 shadow，门禁只观测不干预。
 */
export type GroundingGateMode = 'off' | 'shadow' | 'enforce';

export const GROUNDING_GATE_MODES: readonly GroundingGateMode[] = [
  'off',
  'shadow',
  'enforce',
];

export const DEFAULT_GROUNDING_GATE_MODE: GroundingGateMode = 'shadow';

const logger = new Logger('GroundingGate');

export interface ParsedGroundingGateMode {
  mode: GroundingGateMode;
  invalid: boolean;
}

/** 纯函数：把环境变量原文解析成三态，非法值回落默认值并标记。 */
export function parseGroundingGateMode(
  raw: string | undefined | null,
): ParsedGroundingGateMode {
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (GROUNDING_GATE_MODES.includes(normalized as GroundingGateMode)) {
    return { mode: normalized as GroundingGateMode, invalid: false };
  }
  return {
    mode: DEFAULT_GROUNDING_GATE_MODE,
    invalid: normalized.length > 0,
  };
}

/** 读环境变量；非法值只告警一次，避免每轮对话刷日志。 */
let warnedInvalidValue: string | null = null;

export function readGroundingGateMode(
  raw: string | undefined = process.env.AI_GROUNDING_GATE,
): GroundingGateMode {
  const parsed = parseGroundingGateMode(raw);
  if (parsed.invalid && warnedInvalidValue !== raw) {
    warnedInvalidValue = raw ?? '';
    logger.warn(
      `[grounding-gate] invalid AI_GROUNDING_GATE=${JSON.stringify(raw)}, fallback to '${parsed.mode}'`,
    );
  }
  return parsed.mode;
}

// ================================================================
// 依据分型与发布门禁
// ================================================================

/**
 * 这一轮回答靠什么支撑。
 *
 * 取值与优先级必须和评测口径（`tools/eval/e2e/judge.mjs`）一致：
 *   fallback > tool > kb > none
 * 多一个 `fallback` 是因为线上能直接看到兜底话术；评测侧先判 canned 再分类，
 * 两者结果等价。
 */
export type GroundingType = 'kb' | 'tool' | 'none' | 'fallback';

/**
 * 降级话术：与模型故障的 `AI_FAILURE_REPLY` 区分。
 * 模型没坏、知识库没命中，只是「答不上来」——先确认再回答，别硬编。
 *
 * 文案本体在 `ai-failure-handler.ts`（与其它兜底话术同一张语言表）；
 * 这里重新导出，保持现有 import 路径不变。
 *
 * 它本身也属于「兜底话术」：enforce 把它发出去以后，这一轮就是转人工，
 * 不是回答；trace 分型要记 `fallback`，评测侧才不会被算成「有依据/无依据作答」。
 */
export { NO_EVIDENCE_HANDOFF_REPLY } from '@api/client/ai-customer/ai-failure-handler';

/**
 * 兜底话术不是回答：出现即 `fallback`，不进入任何准确率分母。
 *
 * 用 `HANDOFF_REPLY_TEXTS` 而不是四句中文字面量：降级话术会跟随用户语言，
 * 只认中文的话，英文/菲律宾语降级会被当成真实回答，指标方向就反了。
 */
export const CANNED_REPLIES: readonly string[] = [...HANDOFF_REPLY_TEXTS];

/** 与 `judge.mjs` 的 `cannedReplyCheck` 同义：包含即命中（话术可能被拼接）。 */
export function isCannedReply(content: string | null | undefined): boolean {
  const text = String(content ?? '').trim();
  if (!text) return false;
  return CANNED_REPLIES.some((reply) => text.includes(reply));
}

export interface GroundingInputs {
  /** 本轮回复就是静态兜底话术 */
  canned?: boolean;
  /** 本轮真实检索到的知识库片段数 */
  ragSourceCount?: number;
  /** 回答自带 sources 数（评测口径的 cited） */
  citedSourceCount?: number;
  /**
   * 成功执行的工具调用数。失败的调用不给用户任何事实，
   * 必须由调用方用 `countSuccessfulToolCalls` 过滤后再传。
   */
  toolCallCount?: number;
}

/**
 * 纯函数分型。`canned` 必须来自**未脱敏**的原始回复：
 * 脱敏只影响落库的 snippet，不影响「这句话是不是兜底话术」。
 */
export function classifyGrounding({
  canned = false,
  ragSourceCount = 0,
  citedSourceCount = 0,
  toolCallCount = 0,
}: GroundingInputs = {}): GroundingType {
  if (canned) return 'fallback';
  if (Number(toolCallCount) > 0) return 'tool';
  if (Number(ragSourceCount) > 0 || Number(citedSourceCount) > 0) return 'kb';
  return 'none';
}

/** 工具失败不算依据：只有 status==='OK' 的调用才算事实来源。 */
export function countSuccessfulToolCalls(
  spans: ReadonlyArray<{ status?: string }> | null | undefined,
): number {
  return (spans ?? []).filter((span) => span?.status === 'OK').length;
}

/**
 * 事实断言标记：金额、时效、规则、状态类。
 * 澄清追问（"请问订单号是多少？"）不含这些，不能当成无依据断言。
 *
 * 2026-11-24 enforce 验收发现菲律宾语回复（`multi:rz49+rz50`）整段是
 * 「充值步骤 + 1–24 小时到账」的事实陈述，却因为词表只有中英文被判成澄清放行；
 * 这里补上菲律宾语的时长/金额词（oras 小时、araw/linggo/buwan 日/周/月、
 * minuto/segundo、peso/piso/₱）。
 */
const FACT_ASSERTION = new RegExp(
  [
    // 数字 + 单位：金额 / 时效 / 比例
    '\\d+(?:\\.\\d+)?\\s*(?:元|块|天|日|个工作日|工作日|小时|分钟|秒|%|美元|比索|php|₱)',
    // 规则 / 状态断言
    '政策|规则|条款|规定|标准|要求|支持|可以|不能|必须|需要|有效期|截至|余额|状态|已提交|已领取|已发货|已到账',
    '\\b(?:policy|policies|rule|rules|requirements?|days?|hours?|minutes?|php|usd)\\b',
    // 菲律宾语：时长 / 金额 / 支付渠道（渠道名本身就是事实声明）
    '\\b(?:oras|araw|linggo|buwan|minuto|segundo|peso|piso)\\b',
    '\\b(?:gcash|instapay|7-eleven|mlhuillier|palawan)\\b',
  ].join('|'),
  'i',
);

/** 按分句标点切句（中英文逗号/句号/叹号/问号/分号/顿号/换行），保留结尾标点。 */
const CLAUSE = /[^，,。.!！?？；;\n、]+[，,。.!！?？；;\n、]?/g;

/**
 * 追问从句：本身在向用户提问/确认，不承担事实。
 * `您是想…还是…` 这类二选一追问，宾语里常出现「规则/政策」，不能算断言。
 */
const INTERROGATIVE_CLAUSE =
  /[?？]\s*$|吗|呢|请问|是否|您是想|你是想|您是要|你是要|是想了解|是想查询|are you asking|are you looking|do you want|would you like/i;

/**
 * 回复里有没有「事实断言」——只看陈述从句，追问从句不参与。
 *
 * 门禁真正要拦的是「编造的事实」：金额、时效、规则、状态。2026-11-24
 * enforce 验收发现地址动作流被误降级——模型这一轮没出确认卡、只回了文字，
 * 门禁按「业务意图 + 无依据」转人工，整条动作流中断（业务动作 7/7 → 5/7）。
 * 那种流程性文字（追问、确认提示）不构成事实断言，不该升级成转人工。
 */
export function hasFactualAssertion(
  content: string | null | undefined,
): boolean {
  const text = String(content ?? '').trim();
  if (!text) return false;
  const assertions = (text.match(CLAUSE) ?? [])
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0 && !INTERROGATIVE_CLAUSE.test(clause));
  return FACT_ASSERTION.test(assertions.join(''));
}

/**
 * 纯澄清回复：以问号结尾，且**陈述从句**不含任何事实断言。
 *
 * 只看陈述从句，是因为 2026-11-24 shadow 全量验收发现 12 条误降级：
 * 「您是想了解优惠券的使用规则，还是需要我帮您查一下？」整句都在追问，
 * 却因「规则」被当成规则断言，enforce 下会被换成转人工。
 * 现在的口径：问句/追问从句不参与断言检测，只有陈述才参与。
 *
 * 注意这是「宁可放行」的判定：误判成澄清只是少拦一条，
 * 误判成断言则会把正常追问换成转人工，用户感知更差。
 * 代价：把编造的事实裹进问句里会被放行——由检索质量与 kb 组
 * 准确率兜底，而不是靠门禁兜底。
 */
export function isClarificationOnly(
  content: string | null | undefined,
): boolean {
  const text = String(content ?? '').trim();
  if (!text) return false;
  if (!/[?？]\s*$/.test(text)) return false;
  return !hasFactualAssertion(text);
}

export type GroundingGateDecision = 'allow' | 'degrade';

export interface GroundingGateInputs {
  grounding: GroundingType;
  /** 本轮意图；非业务域（general/transfer/unknown）不受门禁约束 */
  intent?: string | null;
  clarificationOnly?: boolean;
  /**
   * 回复是否包含事实断言（金额/时效/规则/状态）。默认 `true`（fail-closed）：
   * 调用方没算的时候宁可拦，也不要放过一条编造的事实。
   * 纯流程性文字（追问、确认提示）传 `false`，放行。
   */
  factualAssertion?: boolean;
}

/**
 * 发布门禁：只有「业务/知识类意图 + 完全无依据 + 有事实断言」才降级。
 * 闲聊、寒暄、澄清追问、动作流里的流程性文字一律放行。
 */
export function decideGroundingGate({
  grounding,
  intent,
  clarificationOnly = false,
  factualAssertion = true,
}: GroundingGateInputs): GroundingGateDecision {
  if (grounding !== 'none') return 'allow';
  if (clarificationOnly) return 'allow';
  if (!factualAssertion) return 'allow';
  if (!intent || !KNOWLEDGE_CONSULT_INTENTS.has(intent)) return 'allow';
  return 'degrade';
}
