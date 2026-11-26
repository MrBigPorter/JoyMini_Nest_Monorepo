/**
 * 提示词字面量守卫（design D13）。
 *
 * 提示词是运行期可改的载体：管理端激活一个版本，下一轮对话就用它。
 * 把费率/金额写进提示词，等于绕开知识库文档的一致性约束——文档校验绿，
 * 用户听到的却是提示词里那份没人维护的数字。这里按字面量做确定性判定，
 * 不调用模型：
 *   - 比例：`0.8%`、`1.5%`
 *   - 金额：`₱100`、`PHP 80,000`
 *   - 带 peso 字样的金额：`15 pesos`
 *
 * 指向工具结果的占位写法（`₱[amount from tool result]`）不带数字，不会命中。
 */

const PERCENT = /\d+(?:\.\d+)?%/g;
const MONEY = /(?:₱|php)\s?\d[\d,]*(?:\.\d+)?/gi;
const PESO = /\d[\d,]*(?:\.\d+)?\s?(?:peso|pesos)\b/gi;

export const LITERAL_KINDS = [
  { kind: "percent", pattern: PERCENT },
  { kind: "money", pattern: MONEY },
  { kind: "peso", pattern: PESO },
];

/** 递归收集配置里的字符串；路径用于把违规定位到具体字段。 */
function collectStrings(value, path, out) {
  if (typeof value === "string") {
    out.push({ path, text: value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStrings(item, `${path}[${index}]`, out));
    return;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      collectStrings(value[key], `${path}.${key}`, out);
    }
  }
}

/**
 * @param {Array<{name: string, activeVersion: number, config: object}>} prompts
 * @returns {{scanned: number, violations: Array<{name: string, version: number, path: string, kind: string, match: string}>}}
 */
export function scanPrompts(prompts) {
  const violations = [];
  for (const prompt of prompts) {
    const strings = [];
    collectStrings(prompt.config, "config", strings);
    for (const { path, text } of strings) {
      for (const { kind, pattern } of LITERAL_KINDS) {
        for (const match of text.matchAll(pattern)) {
          violations.push({
            name: prompt.name,
            version: prompt.activeVersion,
            path,
            kind,
            match: match[0].trim(),
          });
        }
      }
    }
  }
  return { scanned: prompts.length, violations };
}
