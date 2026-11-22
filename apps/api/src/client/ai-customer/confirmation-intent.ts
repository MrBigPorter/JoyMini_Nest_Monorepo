/**
 * 短确认语识别（确定性，先于意图分类）。
 *
 * 为什么不交给 embedding 分类器：它只看当前一句话，不看 pending action；
 * 「确认」会被判成 kyc/wallet 等业务域，跑错 agent，然后模型在没有工具的
 * 情况下编造「已提交」。确认语义只应该绑定到最近的写操作上。
 *
 * 保守原则：只认整句等于下列词的输入。包含式匹配会把
 * 「可以领券吗」「确认一下我的优惠券」误判成确认。
 */

const AFFIRMATIONS = new Set([
  '确认',
  '确定',
  '可以',
  '好',
  '好的',
  '行',
  '行吧',
  '确认吧',
  '确定吧',
  '可以啊',
  '好呀',
  '是的',
  '对',
  '嗯',
  '嗯嗯',
  '没问题',
  '就这个',
  '就要这个',
  'yes',
  'y',
  'ok',
  'okay',
  'sure',
  'confirm',
  'confirm it',
  'proceed',
  'go ahead',
]);

/** 去掉首尾空白与常见中英文标点，再转小写。 */
function normalize(text: string): string {
  return text
    .trim()
    .replace(/^[\s。.!！?？~～、,，]+|[\s。.!！?？~～、,，]+$/g, '')
    .toLowerCase();
}

export function isShortAffirmation(text: string): boolean {
  const normalized = normalize(text ?? '');
  return normalized.length > 0 && AFFIRMATIONS.has(normalized);
}

/**
 * 6 位数字验证码。
 *
 * 用户经常直接在聊天框里输验证码，而不是点卡片里的输入框。
 * 当存在 CONFIRMED 的提现动作时，这类消息应作为 OTP 提交处理，
 * 而不是当成新的提现请求再建一张卡。
 */
export function isOtpCode(text: string): boolean {
  return /^\d{6}$/.test((text ?? '').trim());
}
