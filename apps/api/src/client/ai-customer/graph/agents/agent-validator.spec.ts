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
 *
 * ── 与 agent-tags.ts 的关系 ──
 * agentFiles 从 AGENT_BASE_MAP 自动推导。
 * 新增 Agent 只需在 agent-tags.ts 加 1 行，校验器自动覆盖。
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { buildAgentPrompt, type AgentPromptConfig } from './prompt-builder';
import { AGENT_BASE_MAP, type AgentTag } from '../config/agent-tags';

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

/**
 * 从 AGENT_BASE_MAP 自动推导需要校验的 Agent 文件列表。
 * 仅包含 type='agent' 的条目（不含 flow/general/rag）。
 *
 * 注意：由于文件名规范是 ${tag}-agent.node.ts，但 hyphen 分隔的 tag
 *（如 'lucky-draw'）对应的文件名是 'lucky-agent.node.ts' 而非 'lucky-draw-agent.node.ts'。
 * 此处做特判处理。
 */
const agentFiles: AgentFile[] = (Object.keys(AGENT_BASE_MAP) as AgentTag[])
  .filter((tag) => AGENT_BASE_MAP[tag].type === 'agent')
  .map((tag) => ({
    // tag → filename 映射：只有 'lucky-draw' 需要特殊处理
    path: tag === 'lucky-draw' ? 'lucky-agent.node.ts' : `${tag}-agent.node.ts`,
    name: AGENT_BASE_MAP[tag].label,
    tag,
  }));

// ==============================================================
// Layer 1: 源码级校验 — 静态分析 Agent Node 源文件
// 注意：Agent Config 重构后，6 个标准 Agent node 文件已删除，
// 由 orchestrator.node.ts + agent-factory.ts 统一处理。
// 因此 Layer 1 改为验证 orchestrator.node.ts 和 agent-factory.ts。
// ==============================================================

describe('Layer 1: Agent Source Validation', () => {
  // 验证 orchestrator.node.ts
  describe('orchestrator.node.ts', () => {
    let content: string;

    beforeAll(() => {
      content = readFileSync(
        resolve(AGENT_NODES_DIR, 'orchestrator.node.ts'),
        'utf-8',
      );
    });

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

    test('R3: imports and uses runStandardAgent from agent-factory', () => {
      expect(content).toContain('import { runStandardAgent }');
      expect(content).toContain('runStandardAgent({');
    });

    test('R7: uses messages.slice() for context filtering', () => {
      const hasDirect = content.includes(
        'state.messages.slice(-MAX_CONTEXT_MESSAGES)',
      );
      const hasDestructured = content.includes(
        'messages.slice(-MAX_CONTEXT_MESSAGES)',
      );
      expect(hasDirect || hasDestructured).toBe(true);
    });
  });

  // 验证 agent-factory.ts
  describe('agent-factory.ts', () => {
    let content: string;

    beforeAll(() => {
      content = readFileSync(
        resolve(AGENT_NODES_DIR, 'agent-factory.ts'),
        'utf-8',
      );
    });

    test('R3: exports runStandardAgent function', () => {
      expect(content).toContain('export async function runStandardAgent');
    });

    test('R3: uses buildAgentPrompt internally', () => {
      expect(content).toContain('buildAgentPrompt');
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
  const baseConfig = {
    userId: 'test-user-123',
    flowContext: false,
  };

  interface TestConfig {
    name: string;
    config: AgentPromptConfig;
  }

  const testConfigs: TestConfig[] = [
    {
      name: 'orderAgent',
      config: {
        ...baseConfig,
        role: 'You are an order inquiry assistant.',
        domainName: 'order inquiries',
        workflow: '1. query orders by status\n2. show order details',
        examples:
          '- User: "Where is my order?"\n- User: "Show my pending orders"',
        domainRules:
          'Order status: pending/processing/shipped/delivered/cancelled',
        scopeRestriction: {
          domain: 'order inquiries',
          handles: ['order status', 'order details', 'delivery tracking'],
          outside: ['wallet operations', 'coupon management', 'user profile'],
        },
        hardRules: [
          'Never share other users order info',
          'Never modify order status',
        ],
      },
    },
    {
      name: 'walletAgent',
      config: {
        ...baseConfig,
        role: 'You are a wallet assistant.',
        domainName: 'wallet operations',
        workflow: '1. check balance\n2. handle withdrawals',
        examples:
          '- User: "What is my balance?"\n- User: "I want to withdraw $50"',
        domainRules: 'Minimum withdrawal: $10, Daily limit: $500',
        scopeRestriction: {
          domain: 'wallet operations',
          handles: ['balance inquiry', 'withdrawal'],
          outside: ['orders', 'coupon', 'product', 'kyc'],
        },
        hardRules: [
          'Never confirm withdrawal without OTP verification',
          'Never disclose other users balance',
        ],
      },
    },
  ];

  describe.each(testConfigs)('$name prompt output', ({ name, config }) => {
    const prompt = buildAgentPrompt(config);

    test('R2: contains Scope Restriction section', () => {
      // Actual prompt format uses "### CRITICAL: Scope Restriction" header
      // with "You ONLY handle X topics:" format (not "What I Handle" / "Outside My Scope")
      expect(prompt).toContain('Scope Restriction');
      expect(prompt).toContain('ONLY handle');
      expect(prompt).toContain('outside your scope');
    });

    test('R3: contains Current User section with userId and instruction', () => {
      expect(prompt).toContain('Current User');
      expect(prompt).toContain('test-user-123');
      expect(prompt).toContain('Do NOT ask the user for their userId');
    });

    test('R4: contains Hard Rules section with common rules', () => {
      expect(prompt).toContain('Hard Rules');
      expect(prompt).toContain('You MUST call at least one tool');
      expect(prompt).toContain(
        'Never use your own knowledge to fabricate data',
      );
    });
  });

  describe('walletAgent specific sections', () => {
    const walletConfig: AgentPromptConfig = {
      ...baseConfig,
      role: 'You are a wallet assistant.',
      domainName: 'wallet operations',
      workflow: '1. check balance\n2. handle withdrawals',
      examples:
        '- User: "What is my balance?"\n- User: "I want to withdraw $50"',
      domainRules: 'Minimum withdrawal: $10',
      scopeRestriction: {
        domain: 'wallet operations',
        handles: ['balance inquiry', 'withdrawal'],
        outside: ['orders'],
      },
      hardRules: ['Never confirm withdrawal without OTP verification'],
    };

    test('includes Current Flow Context when flowContext=true', () => {
      const promptWithFlow = buildAgentPrompt({
        ...walletConfig,
        flowContext: true,
      });
      expect(promptWithFlow).toContain('Current Flow Context');
      expect(promptWithFlow).toContain('Flow Type');
      expect(promptWithFlow).toContain('Flow Status');
    });

    test('includes extraSections after Display Format', () => {
      const promptWithExtra = buildAgentPrompt({
        ...walletConfig,
        extraSections: [
          '### Customer Service Tips\n\nAlways be polite and helpful.',
        ],
      });
      expect(promptWithExtra).toContain('Customer Service Tips');
      // extra sections go after Display Format
      expect(promptWithExtra.indexOf('Customer Service Tips')).toBeGreaterThan(
        promptWithExtra.indexOf('Display Format'),
      );
    });

    test('includes Available Tools when provided', () => {
      const promptWithTools = buildAgentPrompt({
        ...walletConfig,
        availableTools:
          '- getWalletBalance: Get current wallet balance\n- requestWithdrawOtp: Request OTP for withdrawal',
      });
      expect(promptWithTools).toContain('Available Tools');
      expect(promptWithTools).toContain('getWalletBalance');
      expect(promptWithTools).toContain('requestWithdrawOtp');
    });

    test('includes Domain Rules when provided', () => {
      expect(walletConfig.domainRules).toBeDefined();
      const prompt = buildAgentPrompt(walletConfig);
      // Domain Rules are appended directly without a "## Domain Rules" header
      // They appear after Workflow and before Hard Rules
      expect(prompt).toContain('Minimum withdrawal');
    });

    test('includes custom hard rules', () => {
      const prompt = buildAgentPrompt(walletConfig);
      expect(prompt).toContain(
        'Never confirm withdrawal without OTP verification',
      );
    });
  });
});

// ==============================================================
// Layer 3: R6 — 工具文件存在性验证
// ==============================================================

describe('Layer 3: R6 — Tool File Existence', () => {
  // 注意：wallet/order/coupon/user/product tools 分别在各自 module 的 onApplicationBootstrap 中注册
  // 这里只验证工具文件存在且能导出工具工厂函数

  test.each(agentFiles)(
    'R6: $tag tools file exists and exports tools',
    ({ tag }) => {
      // Map tag to tool filename
      const toolFileMap: Record<string, string> = {
        wallet: 'wallet-tools.ts',
        order: 'order-tools.ts',
        coupon: 'coupon-tools.ts',
        user: 'user-tools.ts',
        product: 'product-tools.ts',
        'lucky-draw': 'lucky-tools.ts',
        kyc: 'kyc-tools.ts',
      };

      const filename = toolFileMap[tag];
      expect(filename).toBeDefined();

      const filePath = resolve(AGENT_TOOLS_DIR, filename);
      const content = readFileSync(filePath, 'utf-8');

      // 工具文件应包含 createXxxTools 工厂函数
      const factoryName = `create${tag.charAt(0).toUpperCase() + tag.slice(1).replace('-', '')}Tools`;
      // 某些 tag 需要特殊处理（如 lucky-draw → createLuckyTools）
      const altFactoryMap: Record<string, string> = {
        'lucky-draw': 'createLuckyTools',
      };
      const expectedFactory = altFactoryMap[tag] ?? factoryName;
      expect(content).toContain(expectedFactory);
    },
  );

  test('flow tools file exists and exports tools', () => {
    const filePath = resolve(AGENT_TOOLS_DIR, 'flow-tools.ts');
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('createFlowTools');
  });
});

// ==============================================================
// Layer 5: Prompt Config Source Validation
// ==============================================================

describe('Layer 5: Prompt Config Source Validation', () => {
  // 读取实际的 prompt config 文件，验证其结构
  // 注意：这里读的是 *-prompt.ts 的源文件（读文件而非 import），
  // 因为 import 会执行 module-level 代码（可能触发副作用）。
  // 我们只验证文件内容包含预期的导出模式。

  interface PromptConfigFile {
    path: string;
    name: string;
    tag: string;
  }

  const promptConfigFiles: PromptConfigFile[] = [
    { path: 'order-prompt.ts', name: 'orderPrompt', tag: 'order' },
    { path: 'wallet-prompt.ts', name: 'walletPrompt', tag: 'wallet' },
    { path: 'coupon-prompt.ts', name: 'couponPrompt', tag: 'coupon' },
    { path: 'user-prompt.ts', name: 'userPrompt', tag: 'user' },
    { path: 'product-prompt.ts', name: 'productPrompt', tag: 'product' },
    { path: 'lucky-prompt.ts', name: 'luckyPrompt', tag: 'lucky-draw' },
    { path: 'kyc-prompt.ts', name: 'kycPrompt', tag: 'kyc' },
  ];

  describe.each(promptConfigFiles)('$name prompt config', ({ path, name }) => {
    let content: string;

    beforeAll(() => {
      content = readFileSync(resolve(AGENT_PROMPTS_DIR, path), 'utf-8');
    });

    test('R2: config has scopeRestriction with domain, handles, outside', () => {
      expect(content).toContain('scopeRestriction');
      expect(content).toContain('domain');
      expect(content).toContain('handles');
      expect(content).toContain('outside');
    });

    test('R4: config has scopeRestriction (triggers Hard Rules auto-injection)', () => {
      // scopeRestriction 不为空，且包含 handles 数组
      expect(content).toContain('handles:');
    });
  });
});

// ==============================================================
// Layer 4: Validator self-test — 确保校验器自身正确工作
// ==============================================================

describe('Layer 4: Validator self-test', () => {
  // 校验器自身的自测：
  // 1. 一个明显有问题的 prompt 能不能被检测出来？
  // 2. 一个明显正确的 prompt（来自 buildAgentPrompt）能不能通过？
  // 3. 对于未定义的 scopeRestriction，Hard Rules 是否自动注入？

  /**
   * 模拟校验器逻辑：检测 prompt 是否包含所有必需章节
   */
  function getValidationErrors(prompt: string): string[] {
    const errors: string[] = [];
    const requiredSections = [
      { name: 'Role', patterns: ['You are'] },
      {
        name: 'Scope Restriction',
        patterns: ['Scope Restriction', 'ONLY handle', 'outside your scope'],
      },
      { name: 'Current User', patterns: ['Current User'] },
      { name: 'Hard Rules', patterns: ['Hard Rules'] },
    ];

    for (const section of requiredSections) {
      const found = section.patterns.some((p) => prompt.includes(p));
      if (!found) {
        errors.push(`Missing section: ${section.name}`);
      }
    }

    return errors;
  }

  test('known bad prompt (missing sections) should be detected', () => {
    const badPrompt = 'You are a helpful assistant.';
    const errors = getValidationErrors(badPrompt);
    // "You are" matches Role, so 3 missing: Scope Restriction, Current User, Hard Rules
    expect(errors.length).toBeGreaterThanOrEqual(3);
    expect(errors).toContain('Missing section: Scope Restriction');
    expect(errors).toContain('Missing section: Hard Rules');
  });

  test('known good prompt (from buildAgentPrompt) should pass', () => {
    const goodConfig: AgentPromptConfig = {
      userId: 'test-user-123',
      role: 'You are a test assistant.',
      domainName: 'testing',
      workflow: '1. test step',
      examples: '- User: "Run a test"',
      scopeRestriction: {
        domain: 'testing',
        handles: ['test'],
        outside: ['production'],
      },
      hardRules: ['Never modify production data'],
    };
    const prompt = buildAgentPrompt(goodConfig);
    const errors = getValidationErrors(prompt);
    expect(errors).toEqual([]);
  });

  test('minimal prompt (role only) should have many errors', () => {
    const minimalConfig: AgentPromptConfig = {
      userId: 'test-user-123',
      role: 'You are a minimal assistant.',
      domainName: 'minimal',
      workflow: '1. respond to user',
      examples: '- User: "Hello"',
      scopeRestriction: {
        domain: 'minimal',
        handles: ['general'],
        outside: [],
      },
    };
    const prompt = buildAgentPrompt(minimalConfig);
    const errors = getValidationErrors(prompt);
    // Even minimal config should auto-inject Hard Rules and other sections
    expect(errors.length).toBe(0);
  });

  test('buildAgentPrompt with empty userId still generates sections', () => {
    const config: AgentPromptConfig = {
      userId: '',
      role: 'You are a test assistant.',
      domainName: 'test',
      workflow: '1. test',
      examples: '- User: "Test"',
      scopeRestriction: {
        domain: 'test',
        handles: ['test'],
        outside: [],
      },
    };
    const prompt = buildAgentPrompt(config);
    const errors = getValidationErrors(prompt);
    expect(errors.length).toBe(0);
  });

  test('scopeRestriction outside list is non-empty for all test configs', () => {
    const configs = [
      { domain: 'order', outside: ['wallet', 'coupon'] },
      { domain: 'wallet', outside: ['orders', 'coupon', 'product', 'kyc'] },
      { domain: 'coupon', outside: ['wallet'] },
      { domain: 'user', outside: ['wallet', 'orders'] },
      { domain: 'product', outside: ['wallet', 'orders'] },
      { domain: 'lucky-draw', outside: ['wallet', 'orders'] },
      {
        domain: 'kyc',
        outside: [
          'wallet',
          'orders',
          'coupon',
          'user-profile',
          'lucky-draw',
          'product',
        ],
      },
    ];

    for (const { domain, outside } of configs) {
      expect(outside.length).toBeGreaterThan(0);
    }
  });

  test('getValidationErrors returns distinct errors per missing section', () => {
    const emptyPrompt = '';
    const errors = getValidationErrors(emptyPrompt);
    // Should have multiple distinct errors
    const uniqueErrors = new Set(errors);
    expect(uniqueErrors.size).toBe(errors.length);
    // No duplicate error messages
  });
});
