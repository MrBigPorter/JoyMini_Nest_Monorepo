/**
 * 回复语言策略：跟随用户最后一条消息。
 *
 * 只做中/英/混合/未知四类；不引入外部语言检测库，避免额外依赖和延迟。
 */
export type DetectedLanguage = 'zh' | 'en' | 'mixed' | 'unknown';

const CJK = /[一-鿿]/g;
const LATIN = /[a-zA-Z]/g;

export function detectLanguage(text: string): DetectedLanguage {
  const compact = text.replace(/\s+/g, '');
  if (compact.length === 0) return 'unknown';
  const cjk = (compact.match(CJK) ?? []).length;
  const latin = (compact.match(LATIN) ?? []).length;
  const cjkRatio = cjk / compact.length;
  const latinRatio = latin / compact.length;
  if (cjkRatio >= 0.5 && latinRatio < 0.2) return 'zh';
  if (latinRatio >= 0.7 && cjkRatio < 0.1) return 'en';
  if (cjkRatio > 0.1 && latinRatio > 0.1) return 'mixed';
  return 'unknown';
}

/**
 * 给 Agent 的固定语言指令。放在 system prompt 最后，优先级高于
 * 各业务 Agent 自己的英文示例。
 */
export function replyLanguageInstruction(text: string): string {
  const language = detectLanguage(text);
  switch (language) {
    case 'zh':
      return '## Reply Language\nReply in Simplified Chinese. Do not answer in English.';
    case 'en':
      return '## Reply Language\nReply in English. Do not answer in Chinese.';
    case 'mixed':
      return '## Reply Language\nThe user mixed Chinese and English. Reply in the dominant language of their latest message; if unclear, use Chinese.';
    default:
      return "## Reply Language\nReply in the same language as the user's latest message. If it cannot be determined, use the conversation locale, then English.";
  }
}
