/**
 * lucky-tools — LuckyDraw + Flash Sale Agent 的工具定义
 *
 * ═══════════════════════════════════════════════════════════════
 * 📖 一句话解释
 * ═══════════════════════════════════════════════════════════════
 *
 * 给 LLM 提供"抽奖 + 闪购"相关工具。
 * 用户问"我有哪些抽奖票"、"帮我抽一下"、"秒杀活动有哪些"时，
 * LLM 通过这些工具查真实数据/执行抽奖操作。
 *
 * 注意：抽奖是"写操作"（抽一次少一张票），闪购是"只读"。
 *
 *
 * ═══════════════════════════════════════════════════════════════
 * 🚀 7 个工具速览
 * ═══════════════════════════════════════════════════════════════
 *
 * ┌──────────────────────┬──────────┬──────────────────────────┐
 * │ 工具名称              │ 读写     │ 用途                     │
 * ├──────────────────────┼──────────┼──────────────────────────┤
 * │ ① listTickets        │ 只读     │ 查看我的抽奖票列表       │
 * │ ② listResults        │ 只读     │ 查看我的中奖记录         │
 * │ ③ draw               │ 写操作   │ 使用一张票抽奖           │
 * │ ④ getTicketByOrder   │ 只读     │ 按订单查关联的抽奖票     │
 * │ ⑤ getActiveSessions  │ 只读     │ 查看当前闪购活动场次     │
 * │ ⑥ getSessionProducts │ 只读     │ 查看某个闪购场次商品     │
 * │ ⑦ getFlashProductDetail │ 只读  │ 查看闪购商品详情         │
 * └──────────────────────┴──────────┴──────────────────────────┘
 *
 *
 * ═══════════════════════════════════════════════════════════════
 * 🏷️ 标签策略
 * ═══════════════════════════════════════════════════════════════
 *
 * 抽奖（lucky-draw）和闪购（flash-sale）虽然功能不同，但用户心智模型
 * 接近（"活动/福利"相关），共享同一个 tag 'lucky-draw'。
 * 这样 intent classifier 分类为 lucky-draw 后，两个域的工具同时可用。
 *
 * 特殊：③ draw 工具是"写操作"，同时标记为 ['lucky-draw', 'flow']，
 *       这样 agent-runner 的 flowDataAccumulator 会自动捕获 draw 结果。
 *
 *
 * ═══════════════════════════════════════════════════════════════
 * 🔧 与 product-tools.ts 的异同
 * ═══════════════════════════════════════════════════════════════
 *
 * 相同点：
 *   - 使用 tool() 包装 + Zod schema + 详细 description
 *   - try-catch 包裹 → toolSuccess / toolFailure
 *   - 工厂函数模式：createLuckyTools(service1, service2): TaggedTool[]
 *
 * 不同点：
 *   - lucky-tools 涉及写操作（draw），需要额外注意并发安全
 *   - flash sale 工具是"只读"，与产品搜索逻辑类似
 *   - draw 工具带回 flow 标签（用于 flowDataAccumulator 自动提取）
 */

import { LuckyDrawService } from '@api/common/lucky-draw/lucky-draw.service';
import { ClientFlashSaleService } from '@api/client/flash-sale/flash-sale.service';
import { TaggedTool } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { Logger } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import {
  toolFailure,
  toolSuccess,
} from '@api/client/ai-customer/graph/tools/tool-result';
import { toResultChain } from '@lucky/shared';
import { z } from 'zod';

/**
 * 创建 LuckyDraw + Flash Sale Agent 的所有工具
 *
 * @param luckyDrawService  - 抽奖领域服务（票、结果、抽奖）
 * @param flashSaleService   - 闪购领域服务（场次、商品）
 * @returns TaggedTool[]     - 7 个标记好标签的工具
 */
export const createLuckyTools = (
  luckyDrawService: LuckyDrawService,
  flashSaleService: ClientFlashSaleService,
): TaggedTool[] => {
  const logger = new Logger('LuckyTools');

  return [
    // ================================================================
    // ① listTickets — 查看我的抽奖票列表
    // ================================================================
    // 用户说"我有哪些抽奖票"、"看看我的彩票"时调用。
    // 支持分页 + 筛选未使用的票。
    // 返回票的详情：活动名称、过期时间、是否已用、中奖结果。
    // ================================================================
    {
      tool: tool(
        async ({
          userId,
          page,
          pageSize,
          unusedOnly,
        }: {
          userId: string;
          page?: number;
          pageSize?: number;
          unusedOnly?: boolean;
        }) => {
          logger.log(
            `[lucky-tools:listTickets] userId="${userId}", page=${page ?? 1}`,
          );
          return toResultChain(
            luckyDrawService.listTickets(userId, {
              page: page ?? 1,
              pageSize: pageSize ?? 10,
              unusedOnly,
            }),
          )
            .then((data) =>
              toolSuccess({
                total: data.total,
                page: data.page,
                pageSize: data.pageSize,
                tickets: data.list,
              }),
            )
            .catch((err: Error) =>
              toolFailure(`Failed to list tickets: ${err.message}`),
            );
        },
        {
          name: 'listTickets',
          schema: z.object({
            userId: z.string().describe('The current user ID'),
            page: z
              .number()
              .optional()
              .default(1)
              .describe('Page number for pagination'),
            pageSize: z
              .number()
              .optional()
              .default(10)
              .describe('Number of tickets per page'),
            unusedOnly: z
              .boolean()
              .optional()
              .describe('Filter to show only unused tickets'),
          }),
          description:
            'View my lucky draw tickets. Returns ticket list with status (used/unused), expiration time, activity name, and winning result if already drawn.',
        },
      ),
      tags: ['lucky-draw'],
    },

    // ================================================================
    // ② listResults — 查看我的中奖/抽奖记录
    // ================================================================
    // 用户说"我的中奖记录"、"看看我中了什么"时调用。
    // 返回历史抽奖结果：奖品名称、类型、价值、关联订单。
    // 与 listTickets 的区别：listTickets 关注"票"，listResults 关注"结果"。
    // ================================================================
    {
      tool: tool(
        async ({
          userId,
          page,
          pageSize,
        }: {
          userId: string;
          page?: number;
          pageSize?: number;
        }) => {
          logger.log(
            `[lucky-tools:listResults] userId="${userId}", page=${page ?? 1}`,
          );
          return toResultChain(
            luckyDrawService.listResults(userId, {
              page: page ?? 1,
              pageSize: pageSize ?? 10,
            }),
          )
            .then((data) =>
              toolSuccess({
                total: data.total,
                page: data.page,
                pageSize: data.pageSize,
                results: data.list,
              }),
            )
            .catch((err: Error) =>
              toolFailure(`Failed to list results: ${err.message}`),
            );
        },
        {
          name: 'listResults',
          schema: z.object({
            userId: z.string().describe('The current user ID'),
            page: z
              .number()
              .optional()
              .default(1)
              .describe('Page number for pagination'),
            pageSize: z
              .number()
              .optional()
              .default(10)
              .describe('Number of results per page'),
          }),
          description:
            'View my lucky draw results / winning records. Returns prize name, type (1=coupon/2=coins/3=cash/4=no-win), prize value, and associated order ID.',
        },
      ),
      tags: ['lucky-draw'],
    },

    // ================================================================
    // ③ draw — 使用一张票抽奖（写操作！）
    // ================================================================
    // 用户说"帮我抽奖"、"抽一下"时调用。
    // 这是一个"写操作"——消耗一张票，返回抽奖结果。
    //
    // ⚠️ 重要安全说明：
    //   - 必须用户明确要求"抽"才调用，不可主动建议"要不要抽一下"
    //   - 一次只消耗一张票，不支持批量抽
    //   - 后端使用 $transaction + 原子 UPDATE（并发安全）
    //
    // 🏷️ 双标签策略：
    //   - 'lucky-draw': 在 lucky-draw Agent 运行时可用
    //   - 'flow': flowDataAccumulator 会自动捕获 draw 结果，
    //     将 prizeType/prizeName 写入 state.flowData
    //     （便于 answerSynthesizer 在回复中展示中奖信息）
    // ================================================================
    {
      tool: tool(
        async ({
          userId,
          ticketId,
        }: {
          userId: string;
          ticketId: string;
        }) => {
          logger.log(
            `[lucky-tools:draw] userId="${userId}", ticketId="${ticketId}"`,
          );
          return toResultChain(luckyDrawService.draw(userId, ticketId))
            .then((data) =>
              toolSuccess({
                prizeType: data.prizeType,
                prizeName: data.prizeName,
                prizeValue: data.prizeValue ?? null,
                isWin: data.isWin,
                userCouponId: data.userCouponId ?? null,
                resultId: data.resultId,
                drawnAt: data.drawnAt,
              }),
            )
            .catch((err: Error) =>
              toolFailure(`Failed to draw: ${err.message}`),
            );
        },
        {
          name: 'draw',
          schema: z.object({
            userId: z.string().describe('The current user ID'),
            ticketId: z.string().describe('The ticket ID to use for drawing'),
          }),
          description:
            'Use ONE lucky draw ticket. Returns the draw result: prize type (1=coupon/2=coins/3=cash/4=no-win), prize name, prize value, and whether the user won. Only call when the user explicitly asks to draw.',
        },
      ),
      tags: ['lucky-draw', 'flow'],
    },

    // ================================================================
    // ④ getTicketByOrder — 按订单查询抽奖票
    // ================================================================
    // 用户说"这个订单有没有抽奖票"、"订单 #123 能抽吗"时调用。
    // 通常用于订单详情页场景：用户想知道买了某商品后有没有获得抽奖资格。
    // 返回该订单关联的 ticket 及其中奖状态。
    // ================================================================
    {
      tool: tool(
        async ({
          userId,
          orderId,
        }: {
          userId: string;
          orderId: string;
        }) => {
          logger.log(
            `[lucky-tools:getTicketByOrder] userId="${userId}", orderId="${orderId}"`,
          );
          return toResultChain(luckyDrawService.getTicketByOrder(userId, orderId))
            .then((data) => toolSuccess(data ?? { found: false }))
            .catch((err: Error) =>
              toolFailure(`Failed to get ticket by order: ${err.message}`),
            );
        },
        {
          name: 'getTicketByOrder',
          schema: z.object({
            userId: z.string().describe('The current user ID'),
            orderId: z.string().describe('The order ID to check for tickets'),
          }),
          description:
            'Check if an order has an associated lucky draw ticket. Returns ticket info (id, used status, drawn result) if found, or { found: false } if no ticket exists for this order.',
        },
      ),
      tags: ['lucky-draw'],
    },

    // ================================================================
    // ⑤ getActiveSessions — 查看当前闪购活动场次
    // ================================================================
    // 用户说"有什么秒杀活动"、"闪购有哪些"时调用。
    // 返回当前正在进行的闪购场次列表（标题、时间、商品数量）。
    // 注：只返回"正在进行中"的场次（status=1, start≤now, end≥now）。
    // ================================================================
    {
      tool: tool(
        async () => {
          logger.log(`[lucky-tools:getActiveSessions]`);
          return toResultChain(flashSaleService.getActiveSessions())
            .then((data) =>
              toolSuccess({ sessions: data.list }),
            )
            .catch((err: Error) =>
              toolFailure(`Failed to get active sessions: ${err.message}`),
            );
        },
        {
          name: 'getActiveSessions',
          schema: z.object({}),
          description:
            'View currently active flash sale sessions. Returns session list with title, start/end time, remaining time, and product count. Only returns sessions that are currently active.',
        },
      ),
      tags: ['lucky-draw'],
    },

    // ================================================================
    // ⑥ getSessionProducts — 查看闪购场次商品列表
    // ================================================================
    // 用户说"这个秒杀场次有什么商品"、"看看闪购 #xxx 的商品"时调用。
    // 需要先有 sessionId（从 getActiveSessions 获取）。
    // 返回商品列表：名称、闪购价、库存、原价。
    // ================================================================
    {
      tool: tool(
        async ({ sessionId }: { sessionId: string }) => {
          logger.log(
            `[lucky-tools:getSessionProducts] sessionId="${sessionId}"`,
          );
          return toResultChain(flashSaleService.getSessionProducts(sessionId))
            .then((data) =>
              toolSuccess({
                session: data.session,
                products: data.list,
              }),
            )
            .catch((err: Error) =>
              toolFailure(`Failed to get session products: ${err.message}`),
            );
        },
        {
          name: 'getSessionProducts',
          schema: z.object({
            sessionId: z
              .string()
              .describe('The flash sale session ID to get products for'),
          }),
          description:
            'View products in a specific flash sale session. Returns product list with flash price, original price, stock, product name, and images. The session ID comes from getActiveSessions.',
        },
      ),
      tags: ['lucky-draw'],
    },

    // ================================================================
    // ⑦ getFlashProductDetail — 查看闪购商品详情
    // ================================================================
    // 用户说"这个闪购商品详情"、"看看秒杀商品 #xxx 的详细介绍"时调用。
    // 比 getSessionProducts 多返回：商品描述、配送方式、团购人数等。
    // 需要先有 productId（从 getSessionProducts 获取）。
    // ================================================================
    {
      tool: tool(
        async ({ productId }: { productId: string }) => {
          logger.log(
            `[lucky-tools:getFlashProductDetail] productId="${productId}"`,
          );
          return toResultChain(flashSaleService.getProductDetail(productId))
            .then((data) => toolSuccess(data))
            .catch((err: Error) =>
              toolFailure(`Failed to get flash product detail: ${err.message}`),
            );
        },
        {
          name: 'getFlashProductDetail',
          schema: z.object({
            productId: z
              .string()
              .describe('The flash sale product ID to get details for'),
          }),
          description:
            'View detailed info for a flash sale product. Returns flash price, stock, product details (name, images, description, rules), session info (title, remaining time). The product ID comes from getSessionProducts.',
        },
      ),
      tags: ['lucky-draw'],
    },
  ];
};
