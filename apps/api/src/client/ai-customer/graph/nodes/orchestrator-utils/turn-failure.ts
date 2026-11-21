/**
 * 一轮对话是否“失败”的确定性判定。
 *
 * 用于连续失败计数（repeatCount）：只有 tool_error / 拒绝 / 无证据才累加，
 * 正常回答、换意图、转人工都会清零。判定只看可观测输出，不交给模型自由判断。
 */
import { INFORMATIONAL, SCOPE_REFUSAL } from './knowledge-fallback';

export type TurnFailureReason = 'tool_error' | 'refusal' | 'no_evidence' | null;

export interface TurnFailureInput {
  userInput: string;
  outputs: Array<{ content: string; success?: boolean; error?: string }>;
  ragSourceCount: number;
  hasAgentError: boolean;
}

export interface TurnFailureResult {
  failed: boolean;
  reason: TurnFailureReason;
}

const NO_EVIDENCE =
  /(没有找到|没找到|找不到|查不到|无法确认|没有相关|没有记录|暂无|失败|failed to|error)/i;

export function isInformational(text: string): boolean {
  return INFORMATIONAL.test(text);
}

export function isScopeRefusal(text: string): boolean {
  return SCOPE_REFUSAL.test(text);
}

export function evaluateTurnFailure(
  input: TurnFailureInput,
): TurnFailureResult {
  const outputs = input.outputs.filter((o) => o.content?.trim());

  if (
    input.hasAgentError ||
    outputs.some((o) => o.success === false || !!o.error)
  ) {
    return { failed: true, reason: 'tool_error' };
  }

  if (
    isInformational(input.userInput) &&
    input.ragSourceCount === 0 &&
    outputs.length > 0 &&
    outputs.every((o) => NO_EVIDENCE.test(o.content))
  ) {
    return { failed: true, reason: 'no_evidence' };
  }

  if (outputs.length > 0 && outputs.every((o) => isScopeRefusal(o.content))) {
    return { failed: true, reason: 'refusal' };
  }

  return { failed: false, reason: null };
}


export function nextRepeatCount(
  state: { intent: string; previousIntent?: string; repeatCount?: number },
  failed: boolean,
  forceReset = false,
): number {
  if (forceReset) return 0;
  if (!failed || state.intent !== state.previousIntent) return 0;
  return (state.repeatCount ?? 0) + 1;
}
