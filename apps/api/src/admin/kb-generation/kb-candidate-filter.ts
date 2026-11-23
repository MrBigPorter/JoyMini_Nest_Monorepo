import { detectInjection } from '@api/client/ai-customer/injection-detector';
import { normalizeCandidateText } from './kb-candidate-text.util';
import { RawGoldenQuery, RawKbGeneration } from './kb-generation.types';

export interface FilterContext {
  targetIntent: string;
  documentDomain: string;
  locale: string;
  /** 文档已有的人工/frontmatter 关键词 + 自动关键词（小写） */
  existingKeywords: Set<string>;
}

export interface FilterOutcome {
  keywords: string[];
  examples: string[];
  goldenQueries: RawGoldenQuery[];
  dropped: number;
  reasons: Record<string, number>;
}

const GENERIC_KEYWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'this',
  'that',
  'from',
  'your',
  'you',
  'are',
  'was',
  'were',
  'will',
  'can',
  'how',
  'what',
  'when',
  'where',
  'who',
  'why',
  'please',
  'help',
  'support',
  'customer',
  'service',
  'policy',
  'guide',
  'document',
  'information',
  'details',
  'faq',
]);

/** rag 例句必须是「信息型问题」；动作命令属于业务意图 */
const ACTION_VERBS =
  'cancel|refund|return|withdraw|top\\s?up|transfer|change|update|delete|remove|claim|redeem|buy|order|purchase|pay|send|give|show|check';
const IMPERATIVE_ACTION = new RegExp(
  `^(please\\s+|kindly\\s+|can\\s+you\\s+|could\\s+you\\s+)?(${ACTION_VERBS})\\b` +
    `|^(i\\s+want\\s+to|i'?d\\s+like\\s+to|i\\s+need\\s+to|help\\s+me)\\s+(${ACTION_VERBS})\\b`,
  'i',
);

/** 英文问句以疑问词开头；CJK 没有词边界，更可靠的是「问号或疑问词出现」。 */
const QUESTION_START =
  /^(what|how|why|when|where|who|which|can|could|do|does|is|are|will|should|may|paano|ano|saan|kailan|magkano|pwede|bakit|sino)\b/i;
const CJK_QUESTION =
  /[?？]|怎么|怎样|如何|为什么|为何|多久|多少|哪里|哪个|是否|能不能|可不可以|什么时候|几天|几个/;

function isQuestion(text: string): boolean {
  return QUESTION_START.test(text.trim()) || CJK_QUESTION.test(text);
}

function reason(reasons: Record<string, number>, key: string): void {
  reasons[key] = (reasons[key] ?? 0) + 1;
}

/** 通用安全/长度检查；注入命中一律丢弃 */
function passesBasic(
  text: string,
  min: number,
  max: number,
  reasons: Record<string, number>,
): boolean {
  if (text.length < min || text.length > max) {
    reason(reasons, 'length');
    return false;
  }
  if (/[\r\n\t]/.test(text)) {
    reason(reasons, 'multiline');
    return false;
  }
  if (!/[\p{L}\p{N}]/u.test(text)) {
    reason(reasons, 'no_alnum');
    return false;
  }
  if (detectInjection(text).detected) {
    reason(reasons, 'injection');
    return false;
  }
  return true;
}

function dedupeSeen(
  seen: Set<string>,
  text: string,
  reasons: Record<string, number>,
): boolean {
  const hash = normalizeCandidateText(text);
  if (seen.has(hash)) {
    reason(reasons, 'duplicate_in_batch');
    return false;
  }
  seen.add(hash);
  return true;
}

function normalizeLang(lang: string | undefined, text: string): string {
  const value = (lang ?? '').trim().toLowerCase();
  if (value === 'zh' || value === 'en' || value === 'mixed') return value;
  return /[一-鿿]/.test(text) ? 'zh' : 'en';
}

/**
 * 启发式过滤：不调用模型，先挡掉注入、空泛词、动作型 rag 例句、
 * 非问句 golden，以及批次内重复。
 */
export function filterRawGeneration(
  raw: RawKbGeneration,
  context: FilterContext,
): FilterOutcome {
  const reasons: Record<string, number> = {};
  let dropped = 0;

  const reject = (key: string) => {
    dropped += 1;
    reason(reasons, key);
  };

  // ── keywords ──
  const keywords: string[] = [];
  const keywordSeen = new Set<string>();
  for (const keyword of raw.keywords) {
    if (!passesBasic(keyword, 2, 64, reasons)) {
      dropped += 1;
      continue;
    }
    const normalized = normalizeCandidateText(keyword);
    if (GENERIC_KEYWORDS.has(normalized)) {
      reject('keyword_too_generic');
      continue;
    }
    if (context.existingKeywords.has(normalized)) {
      reject('keyword_exists');
      continue;
    }
    if (!dedupeSeen(keywordSeen, keyword, reasons)) {
      dropped += 1;
      continue;
    }
    keywords.push(keyword);
  }

  // ── intent examples ──
  const examples: string[] = [];
  const exampleSeen = new Set<string>();
  for (const example of raw.intent_examples) {
    if (!passesBasic(example, 3, 200, reasons)) {
      dropped += 1;
      continue;
    }
    // CJK 文本没有词间空格，`split(/\s+/)` 永远只有 1 段；
    // 中文例句一律改用字符数判断，否则整批中文例句会被误杀。
    const hasCjk = /[㐀-鿿]/.test(example);
    const tooShort = hasCjk
      ? example.length < 4
      : example.split(/\s+/).filter(Boolean).length < 2;
    if (tooShort) {
      reject('example_too_short');
      continue;
    }
    if (context.targetIntent === 'rag' && IMPERATIVE_ACTION.test(example)) {
      reject('example_action_not_informational');
      continue;
    }
    if (!dedupeSeen(exampleSeen, example, reasons)) {
      dropped += 1;
      continue;
    }
    examples.push(example);
  }

  // ── golden queries ──
  const goldenQueries: RawGoldenQuery[] = [];
  const goldenSeen = new Set<string>();
  for (const golden of raw.golden_queries) {
    if (!passesBasic(golden.query, 5, 200, reasons)) {
      dropped += 1;
      continue;
    }
    if (!isQuestion(golden.query)) {
      reject('golden_not_a_question');
      continue;
    }
    if (!dedupeSeen(goldenSeen, golden.query, reasons)) {
      dropped += 1;
      continue;
    }
    goldenQueries.push({
      query: golden.query,
      lang: normalizeLang(golden.lang, golden.query),
    });
  }

  return { keywords, examples, goldenQueries, dropped, reasons };
}
