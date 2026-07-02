import { buildAgentPrompt, type AgentPromptConfig } from './prompt-builder';

describe('buildAgentPrompt', () => {
  const minimalConfig: AgentPromptConfig = {
    role: 'You are the test assistant. Respond in English.',
    domainName: 'test',
    userId: 'user_123',
    workflow: 'Step 1: Understand the request\nStep 2: Respond',
    examples: 'User: "Hello"\n→ Reply: "Hi there!"',
    scopeRestriction: {
      domain: 'test',
      handles: ['testing', 'demo'],
      outside: ['production', 'live'],
    },
  };

  it('includes the role section', () => {
    const prompt = buildAgentPrompt(minimalConfig);
    expect(prompt).toContain(minimalConfig.role);
  });

  it('includes Current User section with userId', () => {
    const prompt = buildAgentPrompt(minimalConfig);
    expect(prompt).toContain('## Current User');
    expect(prompt).toContain('user_123');
    expect(prompt).toContain('Do NOT ask the user for their userId');
  });

  it('includes Workflow section', () => {
    const prompt = buildAgentPrompt(minimalConfig);
    expect(prompt).toContain('## Your Workflow');
    expect(prompt).toContain('Step 1: Understand the request');
  });

  it('includes Hard Rules with Scope Restriction', () => {
    const prompt = buildAgentPrompt(minimalConfig);
    expect(prompt).toContain('## Hard Rules');
    expect(prompt).toContain('### CRITICAL: Scope Restriction');
    expect(prompt).toContain('You ONLY handle test');
    expect(prompt).toContain('testing');
    expect(prompt).toContain('outside your scope');
  });

  it('includes common hard rules', () => {
    const prompt = buildAgentPrompt(minimalConfig);
    expect(prompt).toContain('You MUST call at least one tool');
    expect(prompt).toContain('NEVER make up data');
    expect(prompt).toContain('pass the userId parameter');
  });

  it('includes Example section', () => {
    const prompt = buildAgentPrompt(minimalConfig);
    expect(prompt).toContain('## Example');
    expect(prompt).toContain('"Hello"');
  });

  it('does NOT include optional sections by default', () => {
    const prompt = buildAgentPrompt(minimalConfig);
    expect(prompt).not.toContain('## Available Tools');
    expect(prompt).not.toContain('## Display Format');
    expect(prompt).not.toContain('## Current Flow Context');
    expect(prompt).not.toContain(minimalConfig.domainRules ?? '__NONEXISTENT__');
  });

  it('includes Available Tools when provided', () => {
    const prompt = buildAgentPrompt({
      ...minimalConfig,
      availableTools: '1. **Tool A** - Does X\n2. **Tool B** - Does Y',
    });
    expect(prompt).toContain('## Available Tools');
    expect(prompt).toContain('Tool A');
    expect(prompt).toContain('Tool B');
  });

  it('includes Display Format when provided', () => {
    const prompt = buildAgentPrompt({
      ...minimalConfig,
      displayFormat: '- Use ₱ for money\n- Use "coins" for in-app currency',
    });
    expect(prompt).toContain('## Display Format');
    expect(prompt).toContain('₱ for money');
  });

  it('includes Current Flow Context when flowContext=true', () => {
    const prompt = buildAgentPrompt({
      ...minimalConfig,
      flowContext: true,
    });
    expect(prompt).toContain('## Current Flow Context');
    expect(prompt).toContain('updateFlowData');
    expect(prompt).toContain('updateFlowStatus');
  });

  it('includes Domain Rules when provided', () => {
    const prompt = buildAgentPrompt({
      ...minimalConfig,
      domainRules: '## Special Rules\n- Rule A\n- Rule B',
    });
    expect(prompt).toContain('## Special Rules');
    expect(prompt).toContain('Rule A');
  });

  it('includes custom Hard Rules', () => {
    const prompt = buildAgentPrompt({
      ...minimalConfig,
      hardRules: ['- Never do X', '- Always do Y'],
    });
    expect(prompt).toContain('Never do X');
    expect(prompt).toContain('Always do Y');
  });

  it('builds scope restriction with handles and outside lists', () => {
    const prompt = buildAgentPrompt({
      ...minimalConfig,
      scopeRestriction: {
        domain: 'wallet/KYC',
        handles: ['balance', 'transactions', 'withdrawal'],
        outside: ['coupons', 'orders', 'products'],
      },
    });
    expect(prompt).toContain('balance');
    expect(prompt).toContain('transactions');
    expect(prompt).toContain('coupons');
    expect(prompt).toContain('orders');
    expect(prompt).toContain('products');
    expect(prompt).toContain('Do NOT say "this is outside my scope"');
  });

  it('sections are joined with double newlines', () => {
    const prompt = buildAgentPrompt(minimalConfig);
    // Each section should be separated by blank lines
    const sections = prompt.split('\n\n');
    expect(sections.length).toBeGreaterThanOrEqual(5); // role, current user, workflow, hard rules, example
  });
});
