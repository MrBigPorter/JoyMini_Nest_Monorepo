import { createLuckyTools } from './lucky-tools';
import { runWithContext } from '@api/common/logger/trace-context';

/**
 * 抽奖工具的身份边界：
 *   - 票 / 结果 / 抽奖 / 订单关联票使用请求上下文身份
 *   - 模型传的 userId 一律忽略
 *   - 无上下文时 fail-closed；闪购公共查询不依赖身份
 */
describe('lucky-tools 身份边界', () => {
  let luckyDrawService: {
    listTickets: jest.Mock;
    listResults: jest.Mock;
    draw: jest.Mock;
    getTicketByOrder: jest.Mock;
    getTicketForUser: jest.Mock;
  };
  let flashSaleService: {
    getActiveSessions: jest.Mock;
    getSessionProducts: jest.Mock;
    getProductDetail: jest.Mock;
  };
  let tools: ReturnType<typeof createLuckyTools>;

  const getTool = (name: string) => {
    const found = tools.find((t) => t.tool.name === name);
    if (!found) throw new Error(`tool ${name} not found`);
    return found.tool;
  };

  beforeEach(() => {
    luckyDrawService = {
      listTickets: jest.fn().mockResolvedValue({
        list: [],
        total: 0,
        page: 1,
        pageSize: 10,
      }),
      listResults: jest.fn().mockResolvedValue({
        list: [],
        total: 0,
        page: 1,
        pageSize: 10,
      }),
      draw: jest.fn().mockResolvedValue({
        prizeType: 1,
        prizeName: 'Coupon',
        prizeValue: null,
        isWin: true,
        userCouponId: 'uc-1',
        resultId: 'r-1',
        drawnAt: new Date().toISOString(),
      }),
      getTicketByOrder: jest.fn().mockResolvedValue({ hasTicket: false }),
      getTicketForUser: jest.fn().mockResolvedValue({ id: 'ticket-1' }),
    };
    flashSaleService = {
      getActiveSessions: jest.fn().mockResolvedValue({ list: [] }),
      getSessionProducts: jest.fn().mockResolvedValue({
        session: {},
        list: [],
      }),
      getProductDetail: jest.fn().mockResolvedValue({}),
    };

    tools = createLuckyTools(luckyDrawService as any, flashSaleService as any);
  });

  it('票与中奖记录使用请求上下文身份，忽略模型伪造的 userId', async () => {
    await runWithContext({ userId: 'user-A' }, () =>
      getTool('listTickets').invoke({ userId: 'user-B' } as any),
    );
    await runWithContext({ userId: 'user-A' }, () =>
      getTool('listResults').invoke({ userId: 'user-B' } as any),
    );

    expect(luckyDrawService.listTickets).toHaveBeenCalledWith('user-A', {
      page: 1,
      pageSize: 10,
      unusedOnly: undefined,
    });
    expect(luckyDrawService.listResults).toHaveBeenCalledWith('user-A', {
      page: 1,
      pageSize: 10,
    });
  });

  it('抽奖写操作使用请求上下文身份，忽略模型伪造的 userId', async () => {
    await runWithContext({ userId: 'user-A' }, () =>
      getTool('draw').invoke({
        ticketId: 'ticket-1',
        userId: 'user-B',
      } as any),
    );

    expect(luckyDrawService.draw).toHaveBeenCalledWith('user-A', 'ticket-1');
  });

  it('按订单查票使用请求上下文身份', async () => {
    await runWithContext({ userId: 'user-A' }, () =>
      getTool('getTicketByOrder').invoke({
        orderId: 'order-1',
        userId: 'user-B',
      } as any),
    );

    expect(luckyDrawService.getTicketByOrder).toHaveBeenCalledWith(
      'user-A',
      'order-1',
    );
  });

  it('没有请求上下文时抽奖类工具全部 fail-closed', async () => {
    const results = await Promise.all([
      getTool('listTickets').invoke({} as any),
      getTool('listResults').invoke({} as any),
      getTool('draw').invoke({ ticketId: 'ticket-1' } as any),
      getTool('getTicketByOrder').invoke({ orderId: 'order-1' } as any),
    ]);

    for (const raw of results) {
      expect(JSON.parse(raw as string)).toEqual({
        ok: false,
        error: 'Missing request user context',
      });
    }
    expect(luckyDrawService.listTickets).not.toHaveBeenCalled();
    expect(luckyDrawService.listResults).not.toHaveBeenCalled();
    expect(luckyDrawService.draw).not.toHaveBeenCalled();
    expect(luckyDrawService.getTicketByOrder).not.toHaveBeenCalled();
  });

  it('闪购公共查询在没有请求上下文时也能工作', async () => {
    await getTool('getActiveSessions').invoke({} as any);

    expect(flashSaleService.getActiveSessions).toHaveBeenCalled();
  });

  it('归属校验：ticket 不属于当前用户时结构化拒绝（2.6）', async () => {
    luckyDrawService.getTicketForUser.mockResolvedValue(null);

    const result: any = await runWithContext({ userId: 'user-A' }, () =>
      getTool('draw').invoke({ ticketId: 'ticket-of-user-B' } as any),
    );

    expect(JSON.parse(String(result)).error).toContain('FORBIDDEN');
    expect(luckyDrawService.draw).not.toHaveBeenCalled();
  });
});
