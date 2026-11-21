/**
 * 质量待办每行的轻量诊断：只用列表已经返回的字段，避免逐行查链路。
 *
 * 与 context 页的完整诊断互补：
 * - 这里回答「这行值不值得点进去」
 * - 点进上下文后再看未回复时长、flow、节点
 */

export type FeedbackRowDiagnosisKey =
  | 'unanswered'
  | 'sensitive_request'
  | 'language_mismatch'
  | 'no_trace';

export interface FeedbackRowDiagnosis {
  key: FeedbackRowDiagnosisKey;
  label: string;
  severity: 'high' | 'medium';
}

const CJK = /[一-鿿]/;
const SENSITIVE =
  /(银行卡号|银行账号|卡号|身份证号|身份证|信用卡|cvv|card\s*number|account\s*number)/i;

export function diagnoseFeedbackRow(input: {
  signal?: string | null;
  input?: string | null;
  answer?: string | null;
  traceId?: string | null;
}): FeedbackRowDiagnosis[] {
  const flags: FeedbackRowDiagnosis[] = [];
  const answer = input.answer ?? '';

  if (input.signal === 'abandoned') {
    flags.push({
      key: 'unanswered',
      label: '疑似未回复',
      severity: 'high',
    });
  }

  if (answer && SENSITIVE.test(answer)) {
    flags.push({
      key: 'sensitive_request',
      label: '敏感信息',
      severity: 'high',
    });
  }

  if (
    CJK.test(input.input ?? '') &&
    answer.length > 20 &&
    !CJK.test(answer) &&
    (answer.match(/[a-zA-Z]/g)?.length ?? 0) > 20
  ) {
    flags.push({
      key: 'language_mismatch',
      label: '中问英答',
      severity: 'medium',
    });
  }

  if (!input.traceId) {
    flags.push({
      key: 'no_trace',
      label: '无链路',
      severity: 'medium',
    });
  }

  return flags;
}
