/**
 * clean-result — 过滤 Agent 输出中的越权声明文本
 *
 * Agent 可能在工具调用结果中包含 "this is outside my scope" 等 disclaimer，
 * 这些文本不应出现在最终回复中。此函数在 answerSynthesizer 合并多 Agent 结果时使用。
 */

const DISCLAIMER_PATTERNS = [
  /outside\s+(my\s+)?scope/i,
  /not\s+(my\s+)?(field|responsibility|area)/i,
  /cannot\s+help\s+with\s+that/i,
  /please\s+contact\s+(another|the\s+relevant)\s+(team|department)/i,
  /i\s+(only\s+)?handle/i,
];

/**
 * 按行过滤文本，移除包含越权声明模式的行
 *
 * @param text - Agent 输出的原始文本
 * @returns 过滤后的文本（不含 disclaimer 行）
 *
 * @example
 * cleanResult('Data\nThis is outside my scope')
 * // => 'Data'
 *
 * @example
 * cleanResult('Balance: ₱100\nTransactions: 5')
 * // => 'Balance: ₱100\nTransactions: 5'
 */
export function cleanResult(text: string): string {
  return text
    .split('\n')
    .filter((line) => !DISCLAIMER_PATTERNS.some((p) => p.test(line)))
    .join('\n')
    .trim();
}
