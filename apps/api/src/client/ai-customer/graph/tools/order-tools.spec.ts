import { createOrderTools } from './order-tools';
import { runWithContext } from '@api/common/logger/trace-context';

/**
 * 锁住订单工具的身份边界：模型传的 userId 一律忽略，
 * 实际查询身份只来自请求上下文；无上下文时 fail-closed。
 */
describe('order-tools 身份边界', () => {
  let orderService: {
    listOrders: jest.Mock;
    getOrderDetail: jest.Mock;
  };
  let tools: ReturnType<typeof createOrderTools>;

  const getTool = (name: string) => {
    const found = tools.find((t) => t.tool.name === name);
    if (!found) throw new Error(`tool ${name} not found`);
    return found.tool;
  };

  beforeEach(() => {
    orderService = {
      listOrders: jest.fn().mockResolvedValue({
        list: [],
        total: 0,
        page: 1,
        pageSize: 10,
      }),
      getOrderDetail: jest.fn().mockResolvedValue({ id: 'order-1' }),
    };
    tools = createOrderTools(orderService as any);
  });

  it('订单列表使用请求上下文身份，忽略模型伪造的 userId', async () => {
    await runWithContext({ userId: 'user-A' }, () =>
      getTool('getUserOrders').invoke({
        status: 'all',
        userId: 'user-B',
      } as any),
    );

    expect(orderService.listOrders).toHaveBeenCalledWith('user-A', {
      status: 'all',
      page: 1,
      pageSize: 10,
    });
  });

  it('订单详情使用请求上下文身份，忽略模型伪造的 userId', async () => {
    await runWithContext({ userId: 'user-A' }, () =>
      getTool('getOrderInfo').invoke({
        orderId: 'order-1',
        userId: 'user-B',
      } as any),
    );

    expect(orderService.getOrderDetail).toHaveBeenCalledWith(
      'user-A',
      'order-1',
    );
  });

  it('没有请求上下文时两个工具都 fail-closed', async () => {
    const listRaw = await getTool('getUserOrders').invoke({
      status: 'all',
    } as any);
    const detailRaw = await getTool('getOrderInfo').invoke({
      orderId: 'order-1',
    } as any);

    for (const raw of [listRaw, detailRaw]) {
      expect(JSON.parse(raw as string)).toEqual({
        ok: false,
        error: 'Missing request user context',
      });
    }
    expect(orderService.listOrders).not.toHaveBeenCalled();
    expect(orderService.getOrderDetail).not.toHaveBeenCalled();
  });
});
