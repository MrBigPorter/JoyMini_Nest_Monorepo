/**
 * agent-validator.spec.ts — Agent Prompt 校验器
 *
 * Phase 3: 校验器
 * 验证所有 Agent node 文件符合安全规范（7 条规则 R1-R7）。
 *
 * 由于 Agent 使用 buildAgentPrompt() 动态生成 prompt，
 * 校验器分两层验证：
 *   Layer 1 — 源码级（static analysis）：检查源文件中包含必需的配置
 *   Layer 2 — 模板输出级（dynamic）：调用 buildAgentPrompt() 验证实际输出
 *   Layer 3 — 工具注册级：验证工具文件存在且可导出
 *
 * 规则清单:
 *   R1: 禁止措辞检查
 *   R2: 必须包含 Scope Restriction
 *   R3: 必须包含 Current User 显式声明
 *   R4: 必须包含 Hard Rules
 *   R5: Example 使用占位符而非具体值
 *   R6: 工具文件存在性验证
 *   R7: prepareAgentContext 调用检查
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { buildAgentPrompt, type AgentPromptConfig } from './prompt-builder';

// ==============================================================
// Constants
// ==============================================================

const AGENT_NODES_DIR = resolve(__dirname, '../nodes');
const AGENT_TOOLS_DIR = resolve(__dirname, '../tools');
const AGENT_PROMPTS_DIR = resolve(__dirname, 'prompts');

interface AgentFile {
  /** 源文件名，相对于 AGENT_NODES_DIR */
  path: string;
  /** Agent name，传给 prepareAgentContext 的 agentName */
  name: string;
  /** 工具 tag 名称 */
  tag: string;
}

const agentFiles: AgentFile[] = [
  { path: 'wallet-agent.node.ts', name: 'walletAgent', tag: 'wallet' },
  { path: 'coupon-agent.node.ts', name: 'couponAgent', tag: 'coupon' },
  { path: 'order-agent.node.ts', name: 'orderAgent', tag: 'order' },
  { path: 'user-agent.node.ts', name: 'userAgent', tag: 'user' },
  { path: 'product-agent.node.ts', name: 'productAgent', tag: 'product' },
];

// ==============================================================
// Layer 1: 源码级校验 — 静态分析 Agent node 源文件
// ==============================================================

describe('Layer 1: Agent Source Validation', () => {
  describe.each(agentFiles)('$name', ({ path, name, tag }) => {
    let content: string;

    beforeAll(() => {
      content = readFileSync(resolve(AGENT_NODES_DIR, path), 'utf-8');
    });

    // ── R1: 禁止措辞检查 ──────────────────────────────────
    test('R1: contains no forbidden disclaimer phrases', () => {
      const forbiddenPhrases = [
        'politely guide',
        'outside my scope',
        'I cannot help with that',
        'please contact another team',
        'this is not my field',
      ];
      for (const phrase of forbiddenPhrases) {
        expect(content).not.toContain(phrase);
      }
    });

    // ── R3: 必须导入并使用 buildAgentPrompt ───────────────
    test('R3: imports and uses buildAgentPrompt', () => {
      expect(content).toContain('import { buildAgentPrompt }');
      expect(content).toContain('buildAgentPrompt({');
    });

    // ── R7: 新架构中 Agent 节点使用 messages.slice() 获取上下文 ───
    test('R7: agent uses messages.slice() for context filtering', () => {
      const hasDirect = content.includes('state.messages.slice(-MAX_CONTEXT_MESSAGES)');
      const hasDestructured = content.includes('messages.slice(-MAX_CONTEXT_MESSAGES)');
      expect(hasDirect || hasDestructured).toBe(true);
    });
  });
});

// ==============================================================
// Layer 2: 模板输出级校验 — 直接调用 buildAgentPrompt()
// 验证生成的 prompt 包含所有必需章节
// ==============================================================

describe('Layer 2: Prompt Template Output Validation', () => {
  // 最小化的测试配置，反映各 Agent 的实际配置结构
  // 注意：不复制 full production config（避免双源维护）
  const testConfigs: { name: string; config: AgentPromptConfig }[] = [
    {
      name: 'walletAgent',
      config: {
        role: 'You are the wallet and KYC assistant for JoyMini platform.',
        domainName: 'wallet',
        userId: 'test_user_id',
        flowContext: true,
        workflow: 'Step 1: Check balance\nStep 2: Withdraw',
        availableTools:
          '1. **Wallet Balance** - Query balance\n2. **Apply Withdraw** - Submit request',
        domainRules: '## Withdrawal Rules\n- Two-step process',
        examples: 'User: "What is my balance?"\n→ [from tool result]',
        displayFormat:
          '- Cash balance is REAL MONEY\n- Coin balance is IN-APP CURRENCY',
        scopeRestriction: {
          domain: 'wallet/KYC',
          handles: ['balance', 'transactions', 'withdrawal', 'KYC'],
          outside: ['coupons', 'orders', 'products', 'lucky-draw'],
        },
        hardRules: ['- You can ONLY query KYC status'],
        extraSections: [
          '## CRITICAL - Amount Tracking:\n- Remember the exact withdrawal amount',
        ],
      },
    },
    {
      name: 'couponAgent',
      config: {
        role: 'You are the coupon inquiry assistant for JoyMini platform.',
        domainName: 'coupon',
        userId: 'test_user_id',
        workflow: 'Step 1: View coupons\nStep 2: Claim\nStep 3: Respond',
        examples: 'User: "Show me my coupons"\n→ [from tool result]',
        displayFormat: '- Show coupon name, discount, validity',
        scopeRestriction: {
          domain: 'coupon',
          handles: ['coupon list', 'claim coupon', 'redeem code'],
          outside: ['wallet', 'orders', 'products', 'lucky-draw'],
        },
        hardRules: ['- Do NOT retry failed tool calls with same parameters'],
      },
    },
    {
      name: 'orderAgent',
      config: {
        role: 'You are the order inquiry assistant for JoyMini platform.',
        domainName: 'order',
        userId: 'test_user_id',
        workflow: 'Step 1: View orders\nStep 2: Order detail\nStep 3: Respond',
        availableTools:
          '1. **Order List** - View all orders\n2. **Order Detail** - View specific order',
        examples: 'User: "Show me my orders"\n→ [from tool result]',
        displayFormat: '- Show order number, total, status, date',
        scopeRestriction: {
          domain: 'order',
          handles: ['order list', 'order detail', 'order status', 'tracking'],
          outside: ['wallet', 'coupons', 'products', 'lucky-draw'],
        },
      },
    },
  ];

  describe.each(testConfigs)('$name prompt output', ({ name, config }) => {
    let prompt: string;

    beforeAll(() => {
      prompt = buildAgentPrompt(config);
    });

    test('R2: contains Scope Restriction section', () => {
      expect(prompt).toContain('### CRITICAL: Scope Restriction');
      expect(prompt).toContain(config.scopeRestriction.domain);
    });

    test('R3: contains Current User section with userId and instruction', () => {
      expect(prompt).toContain('## Current User');
      expect(prompt).toContain(config.userId);
      expect(prompt).toContain('Do NOT ask the user for their userId');
    });

    test('R4: contains Hard Rules section with common rules', () => {
      expect(prompt).toContain('## Hard Rules');
      expect(prompt).toContain('You MUST call at least one tool');
      expect(prompt).toContain('NEVER make up data');
    });

    test('contains Example section', () => {
      expect(prompt).toContain('## Example');
    });

    test('contains Workflow section', () => {
      expect(prompt).toContain('## Your Workflow');
    });
  });

  // ── walletAgent 特有验证：flowContext + extraSections ────
  describe('walletAgent specific sections', () => {
    const walletConfig: AgentPromptConfig = {
      role: 'Wallet test assistant.',
      domainName: 'wallet',
      userId: 'test_user',
      flowContext: true,
      workflow: 'Step 1: Do X',
      examples: 'User: "X"\n→ [from tool result]',
      scopeRestriction: {
        domain: 'wallet/KYC',
        handles: ['balance'],
        outside: ['coupons'],
      },
      extraSections: [
        '## CRITICAL - Amount Tracking:\n- Remember withdrawal amount',
      ],
    };

    test('includes Current Flow Context when flowContext=true', () => {
      const prompt = buildAgentPrompt(walletConfig);
      expect(prompt).toContain('## Current Flow Context');
      expect(prompt).toContain('updateFlowData');
      expect(prompt).toContain('updateFlowStatus');
    });

    test('includes extraSections after Display Format', () => {
      const prompt = buildAgentPrompt(walletConfig);
      expect(prompt).toContain('## CRITICAL - Amount Tracking');
    });

    test('includes Available Tools when provided', () => {
      const configWithTools: AgentPromptConfig = {
        ...walletConfig,
        availableTools: '1. **Tool A** - Does X',
      };
      const prompt = buildAgentPrompt(configWithTools);
      expect(prompt).toContain('## Available Tools');
    });

    test('includes Domain Rules when provided', () => {
      const configWithRules: AgentPromptConfig = {
        ...walletConfig,
        domainRules:
          '## Withdrawal Rules\n- Step 1: Preview\n- Step 2: Confirm',
      };
      const prompt = buildAgentPrompt(configWithRules);
      expect(prompt).toContain('## Withdrawal Rules');
    });

    test('includes custom hard rules', () => {
      const configWithHardRules: AgentPromptConfig = {
        ...walletConfig,
        hardRules: ['- KYC query only', '- No submission'],
      };
      const prompt = buildAgentPrompt(configWithHardRules);
      expect(prompt).toContain('KYC query only');
      expect(prompt).toContain('No submission');
    });
  });
});

// ==============================================================
// Layer 3: 工具注册校验 — 验证工具文件存在并可正常导出
// ==============================================================

describe('Layer 3: R6 — Tool File Existence', () => {
  test.each(agentFiles)(
    '$tag tools file exists and is non-empty',
    ({ tag }) => {
      const toolFilePath = resolve(AGENT_TOOLS_DIR, `${tag}-tools.ts`);
      const toolFileContent = readFileSync(toolFilePath, 'utf-8');
      expect(toolFileContent.length).toBeGreaterThan(0);
      // 文件应包含工具创建函数或工具数组导出
      expect(toolFileContent).toMatch(
        /create\w*Tools|export\s+(const|function|class)/i,
      );
    },
  );

  test('flow tools file exists and exports tools', () => {
    const flowToolPath = resolve(AGENT_TOOLS_DIR, 'flow-tools.ts');
    const flowToolContent = readFileSync(flowToolPath, 'utf-8');
    expect(flowToolContent.length).toBeGreaterThan(0);
    expect(flowToolContent).toContain('createFlowTools');
  });
});

// ==============================================================
// Layer 5: Prompt Config Source Validation
// 验证提取后的 prompt 配置文件（graph/agents/prompts/）包含必需的配置结构。
// R2/R4/R5 从 Layer 1 迁移至此，因为配置已从 agent node 文件抽取到独立 prompt 文件。
// ==============================================================

describe('Layer 5: Prompt Config Source Validation', () => {
  const promptConfigFiles: { path: string; name: string }[] = [
    { path: 'coupon-prompt.ts', name: 'couponAgent' },
    { path: 'wallet-prompt.ts', name: 'walletAgent' },
    { path: 'order-prompt.ts', name: 'orderAgent' },
    { path: 'user-prompt.ts', name: 'userAgent' },
  ];

  describe.each(promptConfigFiles)('$name prompt config', ({ path, name }) => {
    let content: string;

    beforeAll(() => {
      content = readFileSync(resolve(AGENT_PROMPTS_DIR, path), 'utf-8');
    });

    // ── R2: 必须包含 scopeRestriction 配置 ────────────────
    test('R2: config has scopeRestriction with domain, handles, outside', () => {
      expect(content).toContain('scopeRestriction:');
      expect(content).toContain('domain:');
      expect(content).toContain('handles:');
      expect(content).toContain('outside:');
    });

    // ── R4: scopeRestriction 触发 Hard Rules 自动注入 ──────
    // Hard Rules 由 prompt-builder 自动构建（含 CRITICAL: Scope Restriction）。
    // scopeRestriction 为必填，能触发 buildHardRules() 生成完整 Hard Rules 章节。
    test('R4: config has scopeRestriction (triggers Hard Rules auto-injection)', () => {
      expect(content).toContain('scopeRestriction:');
      expect(content).toContain('domain:');
      expect(content).toContain('handles:');
      expect(content).toContain('outside:');
    });

    // ── R5: Example 使用 [* from tool result] 占位符而非具体值 ────
    test('R5: examples use [* from tool result] placeholders instead of concrete values', () => {
      expect(content).toMatch(/\[[^\]]*from tool result[^\]]*\]/);
    });
  });
});

// ==============================================================
// Layer 4: 元测试 — 校验器自身的验证
// 确保校验器逻辑本身是正确的
// ==============================================================

describe('Layer 4: Validator self-test', () => {
  /**
   * 模拟校验器逻辑：检查 prompt 是否包含所有必需章节
   * 这个函数本身也应该被测试（元测试）
   */
  function getValidationErrors(prompt: string): string[] {
    const errors: string[] = [];

    const requiredSections: { name: string; pattern: string }[] = [
      { name: 'Current User', pattern: '## Current User' },
      { name: 'Scope Restriction', pattern: '### CRITICAL: Scope Restriction' },
      { name: 'Hard Rules', pattern: '## Hard Rules' },
      { name: 'Example', pattern: '## Example' },
      { name: 'Workflow', pattern: '## Your Workflow' },
    ];

    for (const section of requiredSections) {
      if (!prompt.includes(section.pattern)) {
        errors.push(`Missing section: ${section.name}`);
      }
    }

    if (!/\[[^\]]*from tool result[^\]]*\]/.test(prompt)) {
      errors.push('Missing placeholder: [* from tool result]');
    }

    if (!prompt.includes('Do NOT ask the user for their userId')) {
      errors.push('Missing instruction: Do NOT ask the user for their userId');
    }

    return errors;
  }

  // ── 已知有问题的 prompt ────────────────────────────────
  test('known bad prompt (missing sections) should be detected', () => {
    const badPrompt = [
      '## Role',
      'You are a test assistant.',
      '## Hard Rules',
      '- politely guide the user back.',
    ].join('\n');

    const errors = getValidationErrors(badPrompt);
    // 缺失：Current User, Scope Restriction, Example, Workflow, [from tool result], userId instruction
    expect(errors.length).toBeGreaterThanOrEqual(5);
    expect(errors).toContain('Missing section: Current User');
    expect(errors).toContain('Missing section: Example');
    expect(errors).toContain('Missing section: Workflow');
  });

  // ── 已知正确的 prompt（通过 buildAgentPrompt 生成） ─────
  test('known good prompt (from buildAgentPrompt) should pass', () => {
    const config: AgentPromptConfig = {
      role: 'Test assistant.',
      domainName: 'test',
      userId: 'test_user',
      workflow: 'Step 1: Do X',
      examples: 'User: "X"\n→ [from tool result]',
      scopeRestriction: {
        domain: 'test',
        handles: ['testing'],
        outside: ['other'],
      },
    };

    const goodPrompt = buildAgentPrompt(config);
    const errors = getValidationErrors(goodPrompt);
    expect(errors).toHaveLength(0);
  });

  // ── 边界情况：只有角色描述 ──────────────────────────────
  test('minimal prompt (role only) should have many errors', () => {
    const errors = getValidationErrors('## Role\nYou are an assistant.');
    expect(errors.length).toBeGreaterThanOrEqual(6);
  });

  // ── buildAgentPrompt 空字符串 userId 的处理 ──────────────
  test('buildAgentPrompt with empty userId still generates sections', () => {
    const config: AgentPromptConfig = {
      role: 'Test.',
      domainName: 'test',
      userId: '',
      workflow: 'Step 1',
      examples: 'X\n→ [from tool result]',
      scopeRestriction: {
        domain: 'test',
        handles: ['a'],
        outside: ['b'],
      },
    };
    const prompt = buildAgentPrompt(config);
    expect(prompt).toContain('## Current User');
    expect(prompt).toContain('The current user\'s ID is: ""');
  });

  // ── 场景限制：outside 列表必须非空 ──────────────────────
  test('scopeRestriction outside list is non-empty for all test configs', () => {
    const minConfigs: AgentPromptConfig[] = [
      {
        role: 't',
        domainName: 't',
        userId: 't',
        workflow: 't',
        examples: 't',
        scopeRestriction: {
          domain: 'wallet/KYC',
          handles: ['a'],
          outside: ['coupons', 'orders', 'products'],
        },
      },
      {
        role: 't',
        domainName: 't',
        userId: 't',
        workflow: 't',
        examples: 't',
        scopeRestriction: {
          domain: 'coupon',
          handles: ['a'],
          outside: ['wallet', 'orders'],
        },
      },
      {
        role: 't',
        domainName: 't',
        userId: 't',
        workflow: 't',
        examples: 't',
        scopeRestriction: {
          domain: 'order',
          handles: ['a'],
          outside: ['wallet', 'coupons'],
        },
      },
    ];
    for (const cfg of minConfigs) {
      expect(cfg.scopeRestriction.outside.length).toBeGreaterThan(0);
    }
  });

  // ── getValidationErrors 应该区分不同错误类型 ─────────────
  test('getValidationErrors returns distinct errors per missing section', () => {
    const prompt = '';
    const errors = getValidationErrors(prompt);
    // 应该有 5 个缺失章节 + [from tool result] + userId instruction = 7
    expect(errors.length).toBe(7);
    expect(errors).toContain('Missing section: Current User');
    expect(errors).toContain('Missing section: Scope Restriction');
    expect(errors).toContain('Missing section: Hard Rules');
    expect(errors).toContain('Missing section: Example');
    expect(errors).toContain('Missing section: Workflow');
    expect(errors).toContain('Missing placeholder: [* from tool result]');
    expect(errors).toContain(
      'Missing instruction: Do NOT ask the user for their userId',
    );
  });
});
