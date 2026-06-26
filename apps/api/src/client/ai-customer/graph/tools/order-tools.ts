import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { OrderService } from '@api/client/orders/order.service';

/**
 * 工厂函数：创建订单查询工具
 * @param orderService - 从 NestJS DI 注入的 OrderService
 *
 * userId 由 LLM 通过 tool 参数自动传递（方案A）
 */
export const createOrderTools = (orderService: OrderService) => {
  return [
    tool(
      async ({
        userId,
        status,
        page,
        pageSize,
      }: {
        userId: string;
        status?: string;
        page?: number;
        pageSize?: number;
      }) => {
        const result = await orderService.listOrders(userId, {
          status: (status as any) ?? 'all',
          page: page ?? 1,
          pageSize: pageSize ?? 10,
        });
        return JSON.stringify(result);
      },
      {
        name: 'getUserOrders',
        schema: z.object({
          userId: z.string().describe('The current user ID'),
          status: z
            .enum(['all', 'paid', 'unpaid', 'refunded', 'cancelled'])
            .optional()
            .default('all'),
          page: z.number().optional().default(1),
          pageSize: z.number().optional().default(10),
        }),
        description:
          "Get the current user's order list. Can filter by status: all, paid, unpaid, refunded, cancelled.",
      },
    ),
    tool(
      async ({ userId, orderId }: { userId: string; orderId: string }) => {
        const result = await orderService.getOrderDetail(userId, orderId);
        return JSON.stringify(result);
      },
      {
        name: 'getOrderInfo',
        schema: z.object({
          userId: z.string().describe('The current user ID'),
          orderId: z.string().describe('The order ID to look up'),
        }),
        description:
          'Get detailed information about a specific order by order ID.',
      },
    ),
  ];
};
