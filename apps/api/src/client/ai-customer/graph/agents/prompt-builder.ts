/**
 * Agent Prompt 模板构建器 — Template Method Pattern
 *
 * ── 是什么？ ──
 * 标准化所有 Agent 的 system prompt 结构。每个 Agent 需要通过 AgentPromptConfig 提供
 * 自己的"填充内容"，buildAgentPrompt 负责将这些内容按固定顺序组装成完整的 system prompt。
 * 这是 Template Method（模板方法）设计模式的典型应用。
 *
 * ── 10-section 标准模板 ──
 * ① Role（角色定义）
 *    每个 Agent 的自我介绍。例如: "You are the wallet and KYC assistant for JoyMini."
 *    决定了 LLM 以什么身份回答用户的问题。
 *
 * ② Current User（当前用户）
 *    自动注入 userId，确保每个工具调用都携带正确的 userId。
 *    核心安全规则：禁止 LLM 询问用户的 userId（系统已经有）。
 *
 * ③ Current Flow Context（流程状态 - 可选）
 *    仅在 flowContext=true 时生成。告诉 LLM 当前的多步骤流程处于哪个阶段
 *    （如 FILLING → CONFIRMING → COMPLETED）。
 *    用于 wallet agent 跟踪提现申请进度。
 *
 * ④ Workflow（工作流程）
 *    Agent 的执行步骤，LLM 必须严格遵守顺序。例如:
 *    "Step 1: Understand the user's request"
 *    "Step 2: Call the appropriate tool(s)"
 *    "Step 3: If the user confirms, proceed to execute"
 *
 * ⑤ Available Tools（可用工具 - 可选）
 *    列出 Agent 可以调用的工具及其参数说明。
 *    让 LLM 知道"有什么工具可以用、怎么用"。
 *
 * ⑥ Domain Rules（领域规则 - 可选）
 *    特定领域的业务规则。例如 wallet agent 的金额追踪规则。
 *
 * ⑦ Hard Rules（硬性规则）
 *    自动注入 COMMON_HARD_RULES（4 条通用规则）+ Scope Restriction + 自定义规则。
 *    这是最重要的安全层。详细见下方。
 *
 * ⑧ Example（示例）
 *    给出一个完整的用户-Agent 对话示例，让 LLM 理解期望的交互模式。
 *
 * ⑨ Display Format（输出格式 - 可选）
 *    指定 LLM 最终回复的格式。例如以 Markdown 表格列出订单、以列表展示优惠券等。
 *
 * ⑩ Extra Sections（额外章节 - 可选）
 *    钩子方法（Hook Method），允许特定 Agent 注入标准模板之外的特殊规则。
 *    当前只有 wallet agent 使用，用于"金额追踪提醒"。
 *
 * ── Scope Restriction（范围限制）的设计哲学 ──
 * 这是一个关键的规则注入机制。每个 Agent 的 prompt config 中有 scopeRestriction:
 * - domain: Agent 所属领域（如 'wallet/KYC', 'coupon'）
 * - handles: 该 Agent 能处理的具体业务（如 ['balance check', 'withdrawal']）
 * - outside: 该 Agent 不能处理的内容（如 ['orders', 'coupons']）
 *
 * buildScopeSection 会根据这些配置自动生成一句关键指令:
 * "If the user mentions topics outside your scope, ABSOLUTELY do NOT mention them.
 *  Do NOT say 'this is outside my scope' or 'I cannot help with that'."
 *
 * 为什么这么设计？
 * 早期版本（Scheme A）中 Agent 会主动说"这不在我的职责范围内"，
 * 导致用户困惑（"刚才还能聊，现在怎么不行了？"）。
 * 通过阻止 LLM 提及"超出范围"这个概念，将多 Agent 切换对用户完全透明。
 *
 * ── COMMON_HARD_RULES（所有 Agent 都必须遵守的 4 条铁律）──
 * 1. "You MUST call at least one tool" — 防止 LLM 编造数据
 * 2. "Never use your own knowledge to fabricate data" — 防止 LLM 幻觉
 * 3. "Always pass the userId parameter" — 确保数据安全（用户只能查自己的数据）
 * 4. "If a tool returns an error, tell the user the real error" — 透明错误报告
 *
 * ── 生活类比 ──
 * 就像开一家连锁餐厅:
 * - buildAgentPrompt = 餐厅总部的"标准操作手册（SOP）"
 * - 10 sections = 手册的 10 个固定章节（员工须知、安全规范、操作流程...）
 * - AgentPromptConfig = 每家分店填写的"定制内容"（店名、菜单、电话...）
 * - Scope Restriction = "我们家是做火锅的，客户问寿司就无视"
 * - extraSections = 分店老板贴的便签"本店周二特价"
 * - COMMON_HARD_RULES = 总公司的铁律"必须戴手套、必须打小票"
 *
 * ── 面试概念映射 ──
 * - Template Method Pattern: 父类定义骨架、子类实现细节
 * - Scope Restriction: 职责链模式（Chain of Responsibility）的变体
 * - Hook Method: extraSections 是模板方法中的钩子
 * - Config-Driven Architecture: AgentPromptConfig 驱动所有 Agent 行为
 * - LLM Safety: 通过 System Prompt 注入安全规则（Prompt Injection Defense）
 * - Constraint-Driven Design: COMMON_HARD_RULES 是系统级约束
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
  /** 当前流程类型（如 'coupon', 'wallet'），用于 flowContext 章节 */
  flowType?: string;
  /** 当前流程状态（如 'IDLE', 'SELECTING', 'CONFIRMING'），用于 flowContext 章节 */
  flowStatus?: string;
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
  "- If a tool returns an error, tell the user the real error. Don't hide it.",
];

// ============================================================
// Prompt 构建函数
// ============================================================

/**
 * 构建 Scope Restriction 章节
 */
function buildScopeSection(config: ScopeRestriction): string {
  const handlesList = config.handles.map((h) => `  - ${h}`).join('\n');

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

function buildFlowContext(flowType?: string, flowStatus?: string): string {
  const type = flowType || '(not set)';
  const status = flowStatus || 'IDLE';
  return `## Current Flow Context
- Flow Type: ${type}
- Flow Status: ${status}
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
    sections.push(buildFlowContext(config.flowType, config.flowStatus));
  }

  // 4. Workflow
  sections.push(
    `## Your Workflow (Follow these steps exactly)\n\n${config.workflow}`,
  );

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
