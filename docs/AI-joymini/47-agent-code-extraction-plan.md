# Agent 代码提取与校验器方案

> 目标：将 Agent 的重复代码提取为共享模块，使新增 Agent 从「复制粘贴改 300 行」变成「填写 80 行业务逻辑 + 跑校验器验证」

---

## 1. 当前耦合度分析

### 1.1 重复代码统计

| 模块 | wallet-agent | coupon-agent | order-agent | 重复次数 |
|------|:---:|:---:|:---:|:---:|
| Agent 循环（while + tool 执行） | ✅ | ✅ | ✅ | 3 |
| 错误处理（try/catch） | ✅ | ✅ | ✅ | 3 |
| AgentStep 输出格式 | ✅ | ✅ | ✅ | 3 |
| System prompt 外壳（Role + Current User + filterMessages） | ✅ | ✅ | ✅ | 3 |
| Scope Restriction 模板 | ✅ | ✅ | ✅ | 3 |
| Hard Rules 通用部分（MUST call tool, NEVER make up data） | ✅ | ✅ | ✅ | 3 |
| Current User 声明 | ✅ | ✅ | ✅ | 3 |

### 1.2 每文件重复行数估算

```
wallet-agent.node.ts:  ~270 行  →  业务特有 ~150 行（提现规则等） + 可提取 ~120 行
coupon-agent.node.ts:  ~160 行  →  业务特有 ~40 行 + 可提取 ~120 行
order-agent.node.ts:   ~170 行  →  业务特有 ~50 行 + 可提取 ~120 行

总计可提取: ~360 行重复代码 → 合并为 1 个共享模块
```

### 1.3 风险

当前模式：**新增 Agent = 复制一个现有文件，然后改内容**。

这意味着：
- 如果 Scope Restriction 写法更新了，要改 3+ 个文件
- 如果 filterMessages 参数变了，要改 3+ 个文件
- 如果 Agent 循环逻辑有 bug，要修 3+ 个文件
- **没有任何机制阻止开发者漏掉 Scope Restriction**

---

## 2. 提取方案

### 2.1 新建文件结构

```
apps/api/src/client/ai-customer/graph/
├── nodes/
│   ├── wallet-agent.node.ts     ← 只保留业务特有内容
│   ├── coupon-agent.node.ts     ← 同上
│   ├── order-agent.node.ts      ← 同上
│   └── ... 
├── agents/                      ← 新增：共享 Agent 模块
│   ├── agent-runner.ts          ← Agent 循环引擎
│   ├── prompt-builder.ts        ← Prompt 模板构建器
│   └── agent-validator.spec.ts  ← Prompt 校验器（Jest 测试）
├── utils/
│   ├── filter-messages.ts       ← 已有
│   ├── clean-result.ts          ← 从 answerSynthesizer 提取
│   └── ...
```

### 2.2 agent-runner.ts — Agent 循环引擎

```typescript
// 提取所有 Agent 共用的 while 循环 + tool 执行 + 错误处理
// 输入: llmWithTools, initialMessages, tools, agentName
// 输出: { content, messages, agentSteps, totalToolCalls }

export async function runAgentLoop(params: {
  llmWithTools: Runnable;
  initialMessages: any[];
  tools: DynamicStructuredTool[];
  agentName: string;
  flowDataAccumulator?: FlowDataAccumulator;
}): Promise<AgentLoopResult> {
  // ... 现有的 while 循环代码，从 wallet-agent.node.ts 提取
  // 包括: 迭代控制、tool 执行、flowData 提取、错误处理
}
```

### 2.3 prompt-builder.ts — Prompt 模板构建器

```typescript
// 定义 Prompt 模板结构
export interface AgentPromptConfig {
  role: string;           // "You are the wallet and KYC assistant..."
  domainName: string;     // 'wallet'
  userId: string;
  workflow: string;       // Step 1..N 的业务流程
  availableTools?: string; // 可选，工具描述
  domainRules?: string;   // 可选，领域特定规则
  examples: string;       // Example 章节
  displayFormat?: string; // 可选，输出格式
  scopeRestriction: {     // Scope Restriction 配置
    domain: string;       // 'wallet/KYC'
    handles: string[];    // ['balance', 'transactions', ...]
    outside: string[];    // ['coupons', 'orders', ...]
  };
  hardRules?: string[];   // 额外的 Hard Rules
  flowContext?: boolean;  // 是否需要 Current Flow Context 章节
}

// 自动构建完整的 system prompt
export function buildAgentPrompt(config: AgentPromptConfig): string {
  // 按标准模板组装：
  // 1. Role
  // 2. Current User
  // 3. Current Flow Context (可选)
  // 4. Workflow
  // 5. Available Tools (可选)
  // 6. Domain Rules (可选)
  // 7. Hard Rules (自动包含通用规则 + Scope Restriction + 自定义规则)
  // 8. Example
  // 9. Display Format (可选)
}
```

### 2.4 clean-result.ts — 从 answerSynthesizer 提取

```typescript
// 从 answer-synthesizer.node.ts 提取为独立模块
export function cleanResult(text: string): string {
  const patterns = [
    /outside\s+(my\s+)?scope/i,
    /not\s+(my\s+)?(field|responsibility|area)/i,
    /cannot\s+help\s+with\s+that/i,
    /please\s+contact\s+(another|the\s+relevant)\s+(team|department)/i,
    /i\s+(only\s+)?handle/i,
  ];
  return text
    .split('\n')
    .filter((line) => !patterns.some((p) => p.test(line)))
    .join('\n')
    .trim();
}
```

---

## 3. 改造后 Agent Node 的样子

以 wallet-agent 为例，改造后从 ~270 行缩减到 ~80 行：

```typescript
export const createWalletAgentNode = (llmConfig: LlmProviderConfig, registry: ToolRegistryService) => {
  return async (state: typeof AgentState.State): Promise<AgentNodeOutput> => {
    const { userId } = state;
    const tools = [
      ...registry.getToolsByTag('wallet'),
      ...registry.getToolsByTag('flow'),
    ];

    const systemPrompt = buildAgentPrompt({
      role: 'You are the wallet and KYC assistant for JoyMini platform. Respond in English.',
      domainName: 'wallet',
      userId,
      flowContext: true,
      workflow: `Step 1: Understand what the user needs
- Check balance / transactions → getWalletBalance / getWalletTransactions
- Check KYC status → getKycStatus
- View payment channels → getPaymentChannels
- Withdraw money → follow the Withdrawal Rules below
...`,
      availableTools: `1. **Wallet Balance** - Query cash balance, coin balance...
2. **Transaction History** - View recharge/withdraw records...`,
      domainRules: `## Withdrawal Rules (TWO-STEP process):
### Step 1 - Preview
...`, // wallet 特有的提现规则
      scopeRestriction: {
        domain: 'wallet/KYC',
        handles: ['balance', 'transactions', 'withdrawal', 'payment channels', 'KYC'],
        outside: ['coupons', 'orders', 'products', 'lucky-draw'],
      },
      hardRules: [
        'You can ONLY **query** KYC status — do NOT ask users to submit KYC documents',
        'If KYC is not completed, tell the user: "Please complete KYC verification in your profile first"',
      ],
      examples: `User: "What's my balance?"
→ You call getWalletBalance(userId="${userId}")
...`,
      displayFormat: `- **Cash balance** (realBalance) is REAL MONEY (PHP pesos). Use ₱ or PHP as the unit.
- **Coin balance** (coinBalance) is IN-APP CURRENCY, NOT real money. Use "coins" as the unit.`,
    });

    const initialMessages = [
      { role: 'system', content: systemPrompt },
      ...filterAgentMessages(state.messages, state.pendingTasks, state.messageTopics, 'walletAgent')
        .slice(-MAX_CONTEXT_MESSAGES),
    ];

    const llm = createLLM(llmConfig, { temperature: 0 }).bindTools(tools);

    return runAgentLoop({
      llmWithTools: llm,
      initialMessages,
      tools,
      agentName: 'walletAgent',
      flowDataAccumulator: { /* extract flowData from tool calls */ },
    });
  };
};
```

---

## 4. 校验器方案

### 4.1 校验器定位

校验器是 **Jest 测试套件**，不是独立 CLI 工具。好处：
- 跟现有测试体系集成（`yarn workspace @lucky/api test` 自动运行）
- 不需要额外安装
- 测试失败 = CI 失败 = 阻塞合并

### 4.2 校验规则列表

```typescript
// agent-validator.spec.ts
describe('Agent Prompt Validation', () => {
  const agentFiles = [
    { path: 'wallet-agent.node.ts', tag: 'wallet', config: { /* 预期值 */ } },
    { path: 'coupon-agent.node.ts', tag: 'coupon', config: { /* 预期值 */ } },
    { path: 'order-agent.node.ts', tag: 'order', config: { /* 预期值 */ } },
  ];

  // R1: 禁止措辞检查
  test.each(agentFiles)('$path 不包含禁止措辞', ({ path }) => {
    const content = readFileSync(path, 'utf-8');
    const forbidden = [
      'politely guide',
      'outside my scope',
      'I cannot help with that',
      'please contact another team',
      'this is not my field',
    ];
    for (const phrase of forbidden) {
      expect(content).not.toContain(phrase);
    }
  });

  // R2: 必须包含 Scope Restriction
  test.each(agentFiles)('$path 包含 CRITICAL: Scope Restriction', ({ path }) => {
    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('### CRITICAL: Scope Restriction');
  });

  // R3: 必须包含 Current User 显式声明
  test.each(agentFiles)('$path 包含 ## Current User', ({ path }) => {
    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('## Current User');
    expect(content).toContain('The current user\'s ID is:');
    expect(content).toContain('Do NOT ask the user for their userId');
  });

  // R4: 必须包含 ## Hard Rules
  test.each(agentFiles)('$path 包含 ## Hard Rules', ({ path }) => {
    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('## Hard Rules');
  });

  // R5: Example 不使用具体数值
  test.each(agentFiles)('$path 的 Example 使用占位符而非具体值', ({ path }) => {
    const content = readFileSync(path, 'utf-8');
    // 检查 Example 中是否包含 [from tool result] 模式
    const exampleSection = content.match(/## Example[\s\S]*?(?=##|$)/)?.[0] || '';
    expect(exampleSection).toMatch(/\[from tool result\]/);
  });

  // R6: 工具 tag 注册验证
  test.each(agentFiles)('$path 的工具 tag 在 registry 中存在', ({ path, tag }) => {
    const registry = app.get(ToolRegistryService);
    const tools = registry.getToolsByTag(tag);
    expect(tools.length).toBeGreaterThan(0);
  });

  // R7: filterAgentMessages 传入了正确的 agent 名称
  test.each(agentFiles)('$path 调用了 filterAgentMessages', ({ path }) => {
    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('filterAgentMessages(');
  });
});
```

### 4.3 校验器本身的验证

校验器也是代码，需要测试来验证校验器：

```typescript
// agent-validator.spec.ts 底部的元测试
describe('Validator self-test', () => {
  // 构建一个已知有问题的 prompt
  const badPrompt = `## Role
## Hard Rules
- politely guide the user back
`;

  const goodPrompt = `## Role
## Current User
The current user's ID is: "test".
Do NOT ask the user for their userId — you already have it.
## Hard Rules
### CRITICAL: Scope Restriction
- You ONLY handle wallet topics.
- ABSOLUTELY do NOT mention outside-scope topics.
## Example
[from tool result]
`;

  test('已知有问题的 prompt 应被检出', () => {
    expect(validatePrompt(badPrompt)).toHaveLength(1); // 1 个错误
  });

  test('已知正确的 prompt 应通过', () => {
    expect(validatePrompt(goodPrompt)).toHaveLength(0);
  });
});
```

---

## 5. cleanResult 提取

文件：`apps/api/src/client/ai-customer/graph/utils/clean-result.ts`

```typescript
/**
 * 过滤 Agent 输出中的越权声明文本
 * Agent 可能输出 "this is outside my scope" 等 disclaimer，
 * 这些文本不应出现在最终回复中
 */
export function cleanResult(text: string): string {
  const patterns = [
    /outside\s+(my\s+)?scope/i,
    /not\s+(my\s+)?(field|responsibility|area)/i,
    /cannot\s+help\s+with\s+that/i,
    /please\s+contact\s+(another|the\s+relevant)\s+(team|department)/i,
    /i\s+(only\s+)?handle/i,
  ];
  return text
    .split('\n')
    .filter((line) => !patterns.some((p) => p.test(line)))
    .join('\n')
    .trim();
}
```

然后 `answer-synthesizer.node.ts` 中改为：

```typescript
import { cleanResult } from '../utils/clean-result';
// ... 删除内联的 cleanResult 函数定义
```

同时 `clean-result.spec.ts` 中添加测试：

```typescript
describe('cleanResult', () => {
  it('滤掉 "this is outside my scope" 行', () => {
    expect(cleanResult('Data\nThis is outside my scope')).toBe('Data');
  });
  it('保留正常数据行', () => {
    expect(cleanResult('Balance: ₱100\nTransactions: 5')).toBe('Balance: ₱100\nTransactions: 5');
  });
});
```

---

## 6. 改动文件清单

### Phase 1: 提取共享模块（不影响现有功能）

| # | 操作 | 文件 |
|---|------|------|
| 1 | 新建 | `apps/api/src/client/ai-customer/graph/utils/clean-result.ts` |
| 2 | 新建 | `apps/api/src/client/ai-customer/graph/utils/clean-result.spec.ts` |
| 3 | 修改 | `answer-synthesizer.node.ts` — 引用外部 cleanResult，删除内联定义 |
| 4 | 新建 | `apps/api/src/client/ai-customer/graph/agents/prompt-builder.ts` |
| 5 | 新建 | `apps/api/src/client/ai-customer/graph/agents/agent-runner.ts` |
| 6 | 新建 | `apps/api/src/client/ai-customer/graph/agents/prompt-builder.spec.ts` |

### Phase 2: 改造现有 Agent（功能等价，不改变行为）

| # | 操作 | 文件 |
|---|------|------|
| 7 | 修改 | `wallet-agent.node.ts` — 使用 prompt-builder + agent-runner |
| 8 | 修改 | `coupon-agent.node.ts` — 同上 |
| 9 | 修改 | `order-agent.node.ts` — 同上 |

### Phase 3: 校验器

| # | 操作 | 文件 |
|---|------|------|
| 10 | 新建 | `apps/api/src/client/ai-customer/graph/agents/agent-validator.spec.ts` |

### 不做的事

- ❌ 不改变 Agent 行为的逻辑
- ❌ 不改 Graph 路由
- ❌ 不改 state 定义
- ❌ 不改 filter-messages 逻辑

---

## 7. 执行顺序

```
Phase 1: 提取共享模块（无行为变化）
  ├── cleanResult 提取 + 测试  →  1 小时
  ├── prompt-builder  + 测试  →  2 小时
  └── agent-runner  + 测试    →  2 小时

Phase 2: 改造现有 Agent（无行为变化）
  ├── wallet-agent 改造       →  1 小时
  ├── coupon-agent 改造       →  0.5 小时
  ├── order-agent 改造        →  0.5 小时
  └── 验证 tsc + 测试通过     →  0.5 小时

Phase 3: 校验器
  ├── agent-validator.spec.ts  →  2 小时
  └── 确认 CI 通过             →  0.5 小时

总计: ~10 小时
```

---

## 8. 收益

| 指标 | 改造前 | 改造后 |
|------|--------|--------|
| 新增 Agent 需要改动的文件数 | 1（复制整个文件） | 1（只需写业务配置） |
| 新增 Agent 代码量 | ~200-300 行 | ~60-80 行 |
| 遗漏 Scope Restriction 的风险 | ✅ 高（靠人记） | ❌ 低（模板自动注入 + 校验器检查） |
| 遗漏 Current User 的风险 | ✅ 高 | ❌ 低（同上） |
| 遗漏 filterAgentMessages 的风险 | ✅ 高 | ❌ 低（同上） |
| Hard Rules 更新时需改动的文件数 | 3 | 1 |

---

## 9. 风险控制

1. **Phase 1 和 Phase 2 分开执行**：先提取共享模块并写好测试，再改造现有 Agent。每个 Phase 后都跑 `tsc --noEmit` + `yarn test`
2. **不改行为**：提取后的 prompt 内容应与改造前完全一致（逐行对比）
3. **回滚策略**：每个 Agent 单独改造，单个 Agent 有问题只回滚该文件
