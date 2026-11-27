/**
 * 判官原始输出的采集与截断。
 *
 * 判官尝试要落库留痕，但模型输出可能很长（也可能夹带个人信息），
 * 因此统一在服务出口截断，并显式记录是否被截断——消费方不能靠
 * 长度猜「是不是完整的」。
 */
import { redactPiiText } from '@api/common/utils/pii-redaction';

/** 单条原始输出的上限（字符）。现有样本 p95 ≈ 1071，4000 可覆盖全部。 */
export const JUDGE_RAW_OUTPUT_LIMIT = 4000;

export interface JudgeRawCapture {
  /** 截断后的原始输出；空输出记 null，不记空串。 */
  rawOutput: string | null;
  rawTruncated: boolean;
}

export function captureJudgeRawOutput(raw: unknown): JudgeRawCapture {
  const text = typeof raw === 'string' ? raw : String(raw ?? '');
  if (text.length === 0) return { rawOutput: null, rawTruncated: false };
  if (text.length <= JUDGE_RAW_OUTPUT_LIMIT) {
    return { rawOutput: text, rawTruncated: false };
  }
  return {
    rawOutput: text.slice(0, JUDGE_RAW_OUTPUT_LIMIT),
    rawTruncated: true,
  };
}

/**
 * 落库前统一入口：先截断再脱敏（截断在前，避免脱敏把长度撑过上限）。
 * `rawTruncated` 取「上游已截断」或「本次截断」之一，任一为真都表示
 * 存下来的不是完整原文。
 */
export function redactJudgeRawCapture(
  raw: unknown,
  upstreamTruncated = false,
): JudgeRawCapture {
  const captured = captureJudgeRawOutput(raw);
  if (!captured.rawOutput) {
    return { rawOutput: null, rawTruncated: upstreamTruncated };
  }
  return {
    rawOutput: redactPiiText(captured.rawOutput),
    rawTruncated: upstreamTruncated || captured.rawTruncated,
  };
}
