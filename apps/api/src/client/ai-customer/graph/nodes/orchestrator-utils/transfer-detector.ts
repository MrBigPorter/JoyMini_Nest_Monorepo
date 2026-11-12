import { AgentState } from '../../state';

/** 明确要求转人工的关键词 */
const EXPLICIT_TRANSFER_KEYWORDS = [
  '转人工',
  '人工客服',
  '找客服',
  '我要人工',
  '联系客服',
  'human support',
  'talk to human',
  'real person',
  'speak to agent',
];
/**
 * 负面情绪关键词 —— 分级，不用单一列表
 *
 * ⚠️ 这里全部用 `includes()` 做子串匹配，所以词的"误伤面"决定它该进哪一档：
 *   '烦'   → "麻烦帮我查下订单" 命中 → 客气话被判成投诉
 *   '没用' → "这个券我没用过"   命中 → 正常提问被判成抱怨
 *
 * 分两档的原因：
 *   强词：出现即说明用户在表达不满，单次命中就转（"投诉"不可能出现在正常咨询里）
 *   弱词：可能是客套或轻微不满，累计命中 ≥ 2 个才转（"太慢" + "差劲" 才算真的火了）
 * 这样单个弱词会交给 AI 先安抚一次，而不是一上来就把人推给人工。
 */

/** 强负面词：单次命中即转 */
const STRONG_NEGATIVE_KEYWORDS = [
  '投诉',
  '垃圾',
  '气死',
  '差劲',
  '骗子',
  '欺骗',
  'frustrated',
  'angry',
  'useless',
  'terrible',
  'complaint',
  'scam',
];

/** 弱负面词：命中 ≥ 2 个才转（单独出现可能只是客套或轻微抱怨） */
const WEAK_NEGATIVE_KEYWORDS = [
  '烦躁',
  '好烦',
  '很烦',
  '烦死',
  '烦人',
  '没有用',
  '没用处',
  '不管用',
  '太慢',
  'waste',
];

export interface TransferDecision {
  shouldTransfer: boolean;
  reason:
    | 'explicit_request'
    | 'negative_sentiment'
    | 'repeated_attempts'
    | 'none';
}

/**
 * 商品词里的"垃圾"不是骂人。
 *
 * 强词表里的 '垃圾' 也是 `includes()` 匹配，而"这个垃圾袋还有货吗"会命中
 * → 一个正常商品咨询被直接判成投诉并转人工。
 * 中文没有空格、没法用词边界，所以先把常见的商品复合词整词剥掉再匹配。
 * 只剥"垃圾袋/垃圾桶"这类复合词、不剥单字，所以"垃圾，三天就坏了"
 * 仍然会被判成负面情绪。
 */
const JUNK_PRODUCT_COMPOUNDS = [
  '垃圾袋',
  '垃圾桶',
  '垃圾箱',
  '垃圾车',
  '垃圾场',
  '垃圾分类',
  '垃圾处理器',
];

function stripProductCompounds(input: string): string {
  let text = input;
  for (const word of JUNK_PRODUCT_COMPOUNDS) {
    text = text.split(word).join('');
  }
  return text;
}

export function detectTransferRequest(
  input: string,
  state: typeof AgentState.State,
): TransferDecision {
  // Implementation goes here
  // 先剥掉"垃圾袋/垃圾桶"这类商品复合词，避免把它们当成骂人（见上方注释）
  const lowerInput = stripProductCompounds(input.toLowerCase());
  // 1. 明确关键词 → 强制转
  if (
    EXPLICIT_TRANSFER_KEYWORDS.some((keyword) => lowerInput.includes(keyword))
  ) {
    return { shouldTransfer: true, reason: 'explicit_request' };
  }

  // 2. 强负面词 → 单次命中即转
  if (
    STRONG_NEGATIVE_KEYWORDS.some((keyword) => lowerInput.includes(keyword))
  ) {
    return { shouldTransfer: true, reason: 'negative_sentiment' };
  }

  // 3. 弱负面词 → 至少命中 2 个才算真的不满
  //    单个"太慢"很可能是"想确认下快递是不是太慢会退款吗"，交回 AI 处理更合适
  const weakHits = WEAK_NEGATIVE_KEYWORDS.filter((keyword) =>
    lowerInput.includes(keyword),
  ).length;
  if (weakHits >= 2) {
    return { shouldTransfer: true, reason: 'negative_sentiment' };
  }

  // 4. 循环检测 → 同一意图连续 3 次
  const repeated = state.intent === state.previousIntent;
  const repeatCount = repeated ? (state.repeatCount ?? 0) + 1 : 0;
  if (repeatCount >= 3) {
    return { shouldTransfer: true, reason: 'repeated_attempts' };
  }

  // 5. 默认不转
  return { shouldTransfer: false, reason: 'none' };
}
