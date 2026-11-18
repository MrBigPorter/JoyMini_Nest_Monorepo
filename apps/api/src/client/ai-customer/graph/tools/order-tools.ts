import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { IOrderService } from '@api/client/orders/order.service';
import { toLLM } from '@api/common/ai/utils/to-llm';
import { OrderItemDto } from '@api/client/orders/dto/order-item.dto';
import { Logger } from '@nestjs/common';
import { TaggedTool } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import {
  toolFailure,
  toolSuccess,
} from '@api/client/ai-customer/graph/tools/tool-result';
import {
  MISSING_USER_CONTEXT,
  requireToolUserId,
} from '@api/client/ai-customer/graph/tools/tool-identity';
import { toResultChain } from '@lucky/shared';

/**
 * "纯函数" 工厂：创建订单查询工具
 * @param orderService - 从 NestJS DI 注入的 OrderService
 *
 * ── 身份边界 ──
 * userId 由请求上下文（AsyncLocalStorage）提供服务端身份，
 * 不再作为 tool 参数暴露给 LLM。模型无法通过传参查询别人的订单。
 *
 * 所有返回数据通过 toLLM() 语义化后再序列化，
 * 避免 LLM 看到 raw DB 字段（如 virtual: 1）后错误猜测。
 */
export const createOrderTools = (orderService: IOrderService): TaggedTool[] => {
  const logger = new Logger('OrderTools');

  return [
    /**
     * 获取当前用户的订单列表
     * @param status - 订单状态过滤，可选值：all, paid, unpaid, refunded, cancelled
     * @param page - 分页页码，默认 1
     * @param pageSize - 分页大小，默认 10
     * @returns JSON 字符串，包含 total, page, pageSize, orders 列表
     */
    {
      tool: tool(
        async ({
          status,
          page,
          pageSize,
        }: {
          status?: string;
          page?: number;
          pageSize?: number;
        }) => {
          const userId = requireToolUserId('getUserOrders');
          if (!userId) return toolFailure(MISSING_USER_CONTEXT);

          return toResultChain(
            orderService.listOrders(userId, {
              status: (status as any) ?? 'all',
              page: page ?? 1,
              pageSize: pageSize ?? 10,
            }),
          )
            .then((result) => {
              const llmList = (result.list ?? []).map((item: OrderItemDto) =>
                toLLM(item, OrderItemDto, 'en'),
              );
              return toolSuccess({
                total: result.total,
                page: result.page,
                pageSize: result.pageSize,
                orders: llmList,
              });
            })
            .catch((err) =>
              toolFailure(`Failed to query orders: ${err.message}`),
            );
        },
        {
          name: 'getUserOrders',
          schema: z.object({
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
      displayName: 'Looking up your orders...',
      tags: ['order'],
    },
    /**
     * 获取指定订单的详细信息
     * @param orderId - 订单 ID
     * @returns JSON 字符串，包含订单详情
     */
    {
      tool: tool(
        async ({ orderId }: { orderId: string }) => {
          const userId = requireToolUserId('getOrderInfo');
          if (!userId) return toolFailure(MISSING_USER_CONTEXT);

          logger.log(
            `[order-tools:getOrderInfo] userId="${userId}", orderId="${orderId}"`,
          );

          return toResultChain(orderService.getOrderDetail(userId, orderId))
            .then((result) => {
              const llmResult = toLLM(result, OrderItemDto, 'en');
              return JSON.stringify(llmResult, null, 2);
            })
            .catch(() =>
              JSON.stringify({
                error: `Unable to find order information. The order may not exist or does not belong to you.`,
              }),
            );
        },
        {
          name: 'getOrderInfo',
          schema: z.object({
            orderId: z.string().describe('The order ID to look up'),
          }),
          description:
            'Get detailed information about a specific order by order ID.',
        },
      ),
      displayName: 'Getting order details...',
      tags: ['order'],
    },
  ];
};
