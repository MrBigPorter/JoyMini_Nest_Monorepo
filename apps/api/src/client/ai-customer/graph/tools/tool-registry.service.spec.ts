import { ToolRegistryService } from './tool-registry.service';

const tool = (name: string, capability?: any) =>
  ({ tool: { name } as any, tags: ['demo'], capability }) as any;

describe('ToolRegistryService 能力标记（2.x）', () => {
  let registry: ToolRegistryService;

  beforeEach(() => {
    registry = new ToolRegistryService();
  });

  it('未声明能力的工具按只读处理', () => {
    registry.registerMany([tool('searchProducts')]);

    expect(registry.getCapability('searchProducts')).toEqual({
      kind: 'read',
      requiresOwnership: false,
    });
    expect(registry.requiresConfirmation('searchProducts')).toBe(false);
  });

  it('write 能力自动进入确认流程', () => {
    registry.registerMany([
      tool('claimCoupon', { kind: 'write', requiresOwnership: true }),
      tool('createAddress', { kind: 'write', requiresOwnership: true }),
      tool('deleteAddress', { kind: 'write', requiresOwnership: true }),
    ]);

    expect(registry.getWriteToolNames().sort()).toEqual([
      'claimCoupon',
      'createAddress',
      'deleteAddress',
    ]);
    expect(registry.requiresConfirmation('createAddress')).toBe(true);
    expect(registry.requiresConfirmation('deleteAddress')).toBe(true);
  });

  it('未注册工具 fail-closed：不需要确认（调用方应另行拒绝）', () => {
    expect(registry.requiresConfirmation('unknownTool')).toBe(false);
    expect(registry.getCapability('unknownTool')).toBeUndefined();
  });

  it('启动自检列出写工具，不产生缺失能力告警', () => {
    registry.registerMany([
      tool('applyWithdraw', { kind: 'write', requiresOwnership: true }),
      tool('getWalletBalance', { kind: 'read', requiresOwnership: false }),
    ]);
    const log = jest.fn();
    const warn = jest.fn();

    const error = jest.fn();
    registry.auditCapabilities({ log, warn, error });

    expect(log).toHaveBeenCalledWith(expect.stringContaining('applyWithdraw'));
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('显式声明为 read 的副作用工具不阻断启动', () => {
    registry.registerMany([
      tool('requestWithdrawOtp', { kind: 'read', requiresOwnership: false }),
      tool('verifyWithdrawOtp', { kind: 'read', requiresOwnership: false }),
      tool('claimCoupon', { kind: 'write', requiresOwnership: true }),
    ]);
    const error = jest.fn();

    expect(() =>
      registry.auditCapabilities({ log: jest.fn(), warn: jest.fn(), error }),
    ).not.toThrow();
    expect(error).not.toHaveBeenCalled();
  });

  it('完全未声明能力的副作用工具阻断启动', () => {
    registry.registerMany([
      tool('requestWithdrawOtp'), // 没有 capability，会被当成只读
      tool('claimCoupon', { kind: 'write', requiresOwnership: true }),
    ]);
    const error = jest.fn();

    expect(() =>
      registry.auditCapabilities({ log: jest.fn(), warn: jest.fn(), error }),
    ).toThrow(/requestWithdrawOtp/);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('requestWithdrawOtp'),
    );
  });

  it('故意漏登记一个 write 工具 → 自检抛错（写工具 ⊆ 目录）', () => {
    registry.registerMany([
      tool('claimCoupon', { kind: 'write', requiresOwnership: true }),
      tool('transferFunds', { kind: 'write', requiresOwnership: true }),
    ]);

    expect(() =>
      registry.auditCapabilities({
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
    ).toThrow(/transferFunds/);
  });
});
