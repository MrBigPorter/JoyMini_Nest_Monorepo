import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import {
  ACTION_CATALOG,
  getCatalogEntryByAction,
  getCatalogEntryByTool,
  getCatalogToolNames,
} from './action-catalog';
import {
  buildConfirmSummary,
  mapToolToAction,
} from '../nodes/orchestrator-utils/confirm-utils';

/** 每个动作一份「最完整」的参数，用于断言摘要/字段/执行参数非空。 */
const SAMPLE_ARGS: Record<string, Record<string, any>> = {
  applyWithdraw: {
    amount: 500,
    channelId: 2,
    account: '09170000000',
    accountName: 'Ann',
  },
  claimCoupon: { couponId: 'coupon-1' },
  redeemCouponCode: { code: 'JOY10' },
  draw: { ticketId: 'ticket-1' },
  createAddress: {
    contactName: 'Ann',
    phone: '09991234567',
    province: 'Metro Manila',
    city: 'Makati',
    barangay: 'Bel-Air',
    fullAddress: '1 Ayala Ave',
    label: 'Home',
    isDefault: true,
  },
  updateAddress: {
    addressId: 'addr-1',
    contactName: 'Ann',
    phone: '09991234567',
    province: 'Metro Manila',
    city: 'Makati',
    barangay: 'Bel-Air',
    fullAddress: '1 Ayala Ave',
    label: 'Office',
    isDefault: false,
  },
  deleteAddress: { addressId: 'addr-1' },
};

describe('ACTION_CATALOG · 单一动作目录', () => {
  it('目录条目数等于写工具数（写工具 ⊆ 目录）', () => {
    const registry = new ToolRegistryService();
    registry.registerMany(
      getCatalogToolNames().map((name) => ({
        tool: { name } as any,
        tags: ['demo'],
        capability: { kind: 'write' as const, requiresOwnership: false },
      })),
    );

    expect(ACTION_CATALOG.length).toBe(registry.getWriteToolNames().length);
    expect(registry.getWriteToolNames().sort()).toEqual(
      getCatalogToolNames().sort(),
    );
  });

  it('覆盖全部 7 个写工具', () => {
    expect(getCatalogToolNames().sort()).toEqual(
      [
        'applyWithdraw',
        'claimCoupon',
        'redeemCouponCode',
        'draw',
        'createAddress',
        'updateAddress',
        'deleteAddress',
      ].sort(),
    );
  });

  it.each(ACTION_CATALOG.map((entry) => [entry.action, entry.toolName]))(
    '%s：可生成非空 fields / summary / params，且有确认执行分支',
    (action, toolName) => {
      const entry = getCatalogEntryByAction(action)!;
      const args = SAMPLE_ARGS[toolName];

      expect(entry).toBeDefined();
      expect(getCatalogEntryByTool(toolName)?.action).toBe(action);
      expect(typeof entry.execute).toBe('function');

      expect(entry.buildFields(args).length).toBeGreaterThan(0);
      expect(Object.keys(entry.buildSummary(args)).length).toBeGreaterThan(0);
      expect(Object.keys(entry.buildParams(args)).length).toBeGreaterThan(0);

      // mapToolToAction / buildConfirmSummary 必须与目录一致
      expect(mapToolToAction(toolName)).toBe(action);
      expect(buildConfirmSummary({ name: toolName, args })).toMatchObject({
        action,
      });
    },
  );

  it('createAddress / updateAddress 摘要暴露可读字段且手机号脱敏', () => {
    const create = getCatalogEntryByTool('createAddress')!;
    const summary = create.buildSummary(SAMPLE_ARGS.createAddress);

    expect(summary).toMatchObject({
      action: 'create_address',
      contactName: 'Ann',
      province: 'Metro Manila',
      city: 'Makati',
      barangay: 'Bel-Air',
      fullAddress: '1 Ayala Ave',
      label: 'Home',
      isDefault: true,
    });
    expect(summary.phone).toBe('****4567');
    expect(summary.phone).not.toContain('09991234567');

    // 展示字段也必须是可读的中文/英文标签，而不是裸 JSON
    const labels = create
      .buildFields(SAMPLE_ARGS.createAddress)
      .map((field) => field.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        '联系人',
        '电话',
        '省/区',
        '市',
        '区/村',
        '详细地址',
        '标签',
        '默认地址',
      ]),
    );

    // 执行参数保留真实手机号（展示脱敏 ≠ 执行脱敏）
    expect(create.buildParams(SAMPLE_ARGS.createAddress).phone).toBe(
      '09991234567',
    );

    const update = getCatalogEntryByTool('updateAddress')!;
    expect(update.buildSummary(SAMPLE_ARGS.updateAddress)).toMatchObject({
      action: 'update_address',
      addressId: 'addr-1',
    });
    expect(update.buildParams(SAMPLE_ARGS.updateAddress)).toMatchObject({
      addressId: 'addr-1',
      contactName: 'Ann',
    });
  });

  it('只有提现需要 OTP', () => {
    const otpActions = ACTION_CATALOG.filter((entry) => entry.needsOtp).map(
      (entry) => entry.action,
    );
    expect(otpActions).toEqual(['withdraw']);
  });
});
