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
/** 负面情绪关键词 */

const NEGATIVE_KEYWORDS = [
  '烦',
  '投诉',
  '垃圾',
  '没用',
  '太慢',
  '气死',
  '差劲',
  'frustrated',
  'angry',
  'useless',
  'terrible',
  'waste',
  'complaint',
];

export interface TransferDecision {
  shouldTransfer: boolean;
  reason:
    | 'explicit_request'
    | 'negative_sentiment'
    | 'repeated_attempts'
    | 'none';
}

export function detectTransferRequest(
  input: string,
  state: typeof AgentState.State,
): TransferDecision {
  // Implementation goes here
  const lowerInput = input.toLowerCase();
  // 1. 明确关键词 → 强制转
  if (
    EXPLICIT_TRANSFER_KEYWORDS.some((keyword) => lowerInput.includes(keyword))
  ) {
    return { shouldTransfer: true, reason: 'explicit_request' };
  }

  // 2. 负面情绪 → 建议转
  const negative = NEGATIVE_KEYWORDS.some((keyword) =>
    lowerInput.includes(keyword),
  );
  if (negative) {
    return { shouldTransfer: true, reason: 'negative_sentiment' };
  }

  // 3. 循环检测 → 同一意图连续 3 次
  const repeated = state.intent === state.previousIntent;
  const repeatCount = repeated ? (state.repeatCount ?? 0) + 1 : 0;
  if (repeatCount >= 3) {
    return { shouldTransfer: true, reason: 'repeated_attempts' };
  }

  // 4. 默认不转
  return { shouldTransfer: false, reason: 'none' };
}
