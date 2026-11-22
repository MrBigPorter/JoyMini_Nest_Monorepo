import {
  AiActionContextService,
  formatActionContext,
  maskActionSummary,
} from './action-context';

function makePrisma() {
  return {
    aiActionRequest: {
      findFirst: jest.fn(),
    },
  };
}

describe('AiActionContextService', () => {
  it('无动作时返回 null', async () => {
    const prisma = makePrisma();
    prisma.aiActionRequest.findFirst.mockResolvedValue(null);
    const service = new AiActionContextService(prisma as any);

    await expect(service.loadLatest('c1')).resolves.toBeNull();
    expect(prisma.aiActionRequest.findFirst).toHaveBeenCalledWith({
      where: { conversationId: 'c1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('把最新动作映射为上下文并标记过期', async () => {
    const prisma = makePrisma();
    prisma.aiActionRequest.findFirst.mockResolvedValue({
      id: 'a1',
      action: 'withdraw',
      status: 'CONFIRM_CREATED',
      summary: { action: 'withdraw', amount: 100, account: '09171234567' },
      expiresAt: new Date(Date.now() - 1000),
    });
    const service = new AiActionContextService(prisma as any);

    const ctx = await service.loadLatest('c1');

    expect(ctx).toMatchObject({
      requestId: 'a1',
      action: 'withdraw',
      status: 'CONFIRM_CREATED',
      expired: true,
    });
    expect(ctx?.summary.account).toBe('****4567');
    expect(ctx?.expiresAt).toBeTruthy();
  });

  it('未到期的 CONFIRM_CREATED 不标记过期', async () => {
    const prisma = makePrisma();
    prisma.aiActionRequest.findFirst.mockResolvedValue({
      id: 'a1',
      action: 'withdraw',
      status: 'CONFIRM_CREATED',
      summary: {},
      expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new AiActionContextService(prisma as any);

    const ctx = await service.loadLatest('c1');

    expect(ctx?.expired).toBe(false);
  });

  it('读取失败 fail-open 返回 null', async () => {
    const prisma = makePrisma();
    prisma.aiActionRequest.findFirst.mockRejectedValue(new Error('db down'));
    const service = new AiActionContextService(prisma as any);

    await expect(service.loadLatest('c1')).resolves.toBeNull();
  });
});

describe('maskActionSummary', () => {
  it('掩码 account 与 phone，且不修改入参', () => {
    const input = { account: '09171234567', phone: '09990000000', amount: 100 };
    const masked = maskActionSummary(input);

    expect(masked.account).toBe('****4567');
    expect(masked.phone).toBe('****0000');
    expect(masked.amount).toBe(100);
    expect(input.account).toBe('09171234567');
  });

  it('短号码整体掩码', () => {
    expect(maskActionSummary({ account: '123' }).account).toBe('****');
  });
});

describe('formatActionContext', () => {
  it('null 返回空串', () => {
    expect(formatActionContext(null)).toBe('');
  });

  it('活卡片提示必须点击卡片确认', () => {
    const text = formatActionContext({
      requestId: 'a1',
      action: 'withdraw',
      status: 'CONFIRM_CREATED',
      summary: { amount: 100 },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      expired: false,
    });

    expect(text).toContain('lastAction: withdraw');
    expect(text).toContain('lastActionStatus: CONFIRM_CREATED');
    expect(text).toContain('需要在卡片上点击确认');
  });

  it('过期卡片提示重新发起', () => {
    const text = formatActionContext({
      requestId: 'a1',
      action: 'withdraw',
      status: 'EXPIRED',
      summary: {},
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      expired: true,
    });

    expect(text).toContain('lastActionStatus: EXPIRED');
    expect(text).toContain('重新发起');
  });
});
