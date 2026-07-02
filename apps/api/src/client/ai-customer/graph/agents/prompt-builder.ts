/**
 * prompt-builder — Agent Prompt 模板构建器
 *
 * 标准化所有 Agent 的 system prompt 结构，自动注入：
 * - Role
 * - Current User
 * - Current Flow Context（可选）
 * - Workflow
 * - Available Tools（可选）
 * - Domain Rules（可选）
 * - Hard Rules（通用规则 + Scope Restriction + 自定义规则）
 * - Example
 * - Display Format（可选）
 *
 * 确保新增 Agent 不会遗漏关键安全规则（Scope Restriction、Current User 等）。
 */

export interface ScopeRestriction {
  /** Agent 所属领域名称，如 'wallet/KYC'、'coupon' */
  domain: string;
  /** Agent 处理的业务范围列表 */
  handles: string[];
  /** Agent 不处理的业务范围列表 */
  outside: string[];
}

export interface AgentPromptConfig {
  /** Role 描述，如 "You are the wallet and KYC assistant for JoyMini platform. Respond in English." */
  role: string;
  /** 领域名称，用于日志和 Scope Restriction 模板 */
  domainName: string;
  /** 当前用户 ID */
  userId: string;
  /** Workflow 步骤说明 */
  workflow: string;
  /** 可用工具描述（可选） */
  availableTools?: string;
  /** 领域特定规则（可选） */
  domainRules?: string;
  /** Example 章节内容 */
  examples: string;
  /** 输出格式说明（可选） */
  displayFormat?: string;
  /** Scope Restriction 配置 */
  scopeRestriction: ScopeRestriction;
  /** 额外的 Hard Rules（可选） */
  hardRules?: string[];
  /** 是否包含 Current Flow Context 章节（可选，默认 false） */
  flowContext?: boolean;
  /**
   * 额外的自定义章节（可选），追加到 Display Format 之后。
   * 每个元素是一个独立的 markdown 章节标题 + 内容。
   * 用于 wallet agent 的 "CRITICAL - Amount Tracking" 等特有章节。
   */
  extraSections?: string[];
}

// ============================================================
// 通用 Hard Rules（所有 Agent 都必须包含）
// ============================================================

const COMMON_HARD_RULES = [
  '- **You MUST call at least one tool** to answer questions. NEVER make up data.',
  '- Never use your own knowledge to fabricate data. All data must come from tool calls.',
  '- Always pass the userId parameter when calling tools.',
  '- If a tool returns an error, tell the user the real error. Don\'t hide it.',
];

// ============================================================
// Prompt 构建函数
// ============================================================

/**
 * 构建 Scope Restriction 章节
 */
function buildScopeSection(config: ScopeRestriction): string {
  const handlesList = config.handles.map((h) => `  - ${h}`).join('\n');
  const outsideList = config.outside.map((o) => `  - ${o}`).join('\n');

  return `### CRITICAL: Scope Restriction
- You ONLY handle ${config.domain} topics:
${handlesList}.
- If the user's message mentions topics outside your scope (${config.outside.join(', ')}, etc.), ABSOLUTELY do NOT mention them. Do NOT say "this is outside my scope" or "I cannot help with that" or "please contact another team". Other specialized assistants will handle those parts.
- Only respond to the ${config.domain}-related part of the user's question. Ignore all non-${config.domain} content completely.`;
}

function buildCurrentUser(userId: string): string {
  return `## Current User
The current user's ID is: "${userId}".
Use this ID when calling any tool that requires the userId parameter.
Do NOT ask the user for their userId — you already have it.`;
}

function buildFlowContext(): string {
  return `## Current Flow Context
- Flow Type: \${(state as any).flowType || '(not set)'}
- Flow Status: \${(state as any).flowStatus || 'IDLE'}
Use updateFlowData to save information collected from the user.
Use updateFlowStatus to advance the workflow (e.g. FILLING → CONFIRMING → COMPLETED).`;
}

function buildHardRules(
  scopeRestriction: ScopeRestriction,
  customRules?: string[],
): string {
  const scopeSection = buildScopeSection(scopeRestriction);
  const rules = [...COMMON_HARD_RULES];
  if (customRules) {
    rules.push(...customRules);
  }
  return `## Hard Rules (Violation = mistake)

${scopeSection}

${rules.map((r) => (r.startsWith('- ') ? r : `- ${r}`)).join('\n')}`;
}

/**
 * 构建完整的 Agent system prompt
 *
 * @param config - Agent prompt 配置
 * @returns 完整的 system prompt 字符串
 *
 * @example
 * const prompt = buildAgentPrompt({
 *   role: 'You are the wallet assistant...',
 *   domainName: 'wallet',
 *   userId: 'user_123',
 *   workflow: 'Step 1: Understand...',
 *   examples: 'User: "..." → ...',
 *   scopeRestriction: { domain: 'wallet', handles: ['balance'], outside: ['orders'] },
 * });
 */
export function buildAgentPrompt(config: AgentPromptConfig): string {
  const sections: string[] = [];

  // 1. Role
  sections.push(config.role);

  // 2. Current User
  sections.push(buildCurrentUser(config.userId));

  // 3. Current Flow Context (optional)
  if (config.flowContext) {
    sections.push(buildFlowContext());
  }

  // 4. Workflow
  sections.push(`## Your Workflow (Follow these steps exactly)\n\n${config.workflow}`);

  // 5. Available Tools (optional)
  if (config.availableTools) {
    sections.push(`## Available Tools\n\n${config.availableTools}`);
  }

  // 6. Domain Rules (optional)
  if (config.domainRules) {
    sections.push(config.domainRules);
  }

  // 7. Hard Rules
  sections.push(buildHardRules(config.scopeRestriction, config.hardRules));

  // 8. Example
  sections.push(`## Example (Follow this pattern)\n\n${config.examples}`);

  // 9. Display Format (optional)
  if (config.displayFormat) {
    sections.push(`## Display Format\n\n${config.displayFormat}`);
  }

  // 10. Extra sections (optional) — appended after all standard sections
  if (config.extraSections && config.extraSections.length > 0) {
    sections.push(...config.extraSections);
  }

  return sections.join('\n\n');
}
