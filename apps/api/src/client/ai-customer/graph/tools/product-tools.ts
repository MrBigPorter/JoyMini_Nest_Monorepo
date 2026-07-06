// ============================================================
// product-tools.ts — Product Search & Browse Tools
// ============================================================
// 遵循与 order-tools.ts 相同的 "纯函数工厂" 模式。
// 所有工具为 read-only（仅查询，不写数据库）。
//
// 工具清单:
//   ① searchProducts       — 搜索/浏览商品列表
//   ② getProductDetail     — 商品详情
//   ③ getProductStatus     — 商品实时状态
//   ④ getHotProducts       — 热门商品列表
//   ⑤ getProductCategories — 商品分类列表
// ============================================================

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ITreasureService } from '@api/client/treasure/treasure.service';
import { CategoryService } from '@api/client/category/category.service';
import { toLLM } from '@api/common/ai/utils/to-llm';
import { TreasureResponseDto } from '@api/client/treasure/dto/treasure-response-dto';
import { TreasureStatusDto } from '@api/client/treasure/dto/treasure-response-dto';
import { HotGroupItemDto } from '@api/client/treasure/dto/hot_croup_item.dto';
import { Logger } from '@nestjs/common';
import { TaggedTool } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import {
  toolFailure,
  toolSuccess,
} from '@api/client/ai-customer/graph/tools/tool-result';
import { toResultChain } from '@lucky/shared';

/**
 * "纯函数" 工厂：创建商品浏览/搜索工具
 * @param treasureService - 从 NestJS DI 注入的 TreasureService
 * @param categoryService - 从 NestJS DI 注入的 CategoryService
 *
 * 所有返回数据通过 toLLM() 语义化后再序列化，
 * 避免 LLM 看到 raw DB 字段（如 virtual: 1）后错误猜测。
 */
export const createProductTools = (
  treasureService: ITreasureService,
  categoryService: CategoryService,
): TaggedTool[] => {
  const logger = new Logger('ProductTools');

  return [
    /**
     * 搜索/浏览商品列表
     * @param userId - 当前用户 ID，由 LLM 自动传递
     * @param q - 关键词搜索
     * @param categoryId - 分类筛选
     * @param filterType - 销售状态筛选: ALL, ON_SALE, PRE_SALE
     * @param page - 页码，默认 1
     * @param pageSize - 每页数量，默认 10
     * @returns JSON 字符串，包含分页信息和商品列表
     */
    {
      tool: tool(
        async ({
          userId,
          q,
          categoryId,
          filterType,
          page,
          pageSize,
        }: {
          userId: string;
          q?: string;
          categoryId?: number;
          filterType?: string;
          page?: number;
          pageSize?: number;
        }) =>
          toResultChain(
            treasureService.list({
              page: page ?? 1,
              pageSize: pageSize ?? 10,
              q: q ?? undefined,
              categoryId: categoryId ?? undefined,
              filterType: filterType ?? 'ALL',
            }),
          )
            .then((data) => {
              // 将列表中的每个商品通过 toLLM 语义化
              const llmList = (data.list ?? []).map((item: any) =>
                toLLM(item, TreasureResponseDto, 'en'),
              );
              return toolSuccess({
                total: data.total,
                page: data.page,
                pageSize: data.pageSize,
                products: llmList,
              });
            })
            .catch((err: Error) =>
              toolFailure(`Failed to search products: ${err.message}`),
            ),
        {
          name: 'searchProducts',
          schema: z.object({
            userId: z.string().describe('The current user ID'),
            q: z
              .string()
              .optional()
              .describe('Search keyword to filter products by name'),
            categoryId: z.number().optional().describe('Filter by category ID'),
            filterType: z
              .enum(['ALL', 'ON_SALE', 'PRE_SALE'])
              .optional()
              .default('ALL')
              .describe('Filter by sale status: ALL, ON_SALE, PRE_SALE'),
            page: z.number().optional().default(1),
            pageSize: z.number().optional().default(10),
          }),
          description:
            'Search or browse products. Can filter by keyword, category, and sale status (ON_SALE, PRE_SALE).',
        },
      ),
      tags: ['product'],
    },

    /**
     * 获取指定商品的详细信息
     * @param userId - 当前用户 ID，由 LLM 自动传递
     * @param productId - 商品 ID
     * @returns JSON 字符串，包含商品详情（含描述、图片、分类等）
     */
    {
      tool: tool(
        async ({
          userId,
          productId,
        }: {
          userId: string;
          productId: string;
        }) => {
          logger.log(
            `[product-tools:getProductDetail] userId="${userId}", productId="${productId}"`,
          );
          return toResultChain(treasureService.detail(productId))
            .then((data) => {
              const llmResult = toLLM(data, TreasureResponseDto, 'en');
              return JSON.stringify(llmResult, null, 2);
            })
            .catch(() =>
              JSON.stringify({
                error: `Unable to find product information. The product may not exist.`,
              }),
            );
        },
        {
          name: 'getProductDetail',
          schema: z.object({
            userId: z.string().describe('The current user ID'),
            productId: z.string().describe('The product ID to look up'),
          }),
          description:
            'Get detailed information about a specific product by product ID.',
        },
      ),
      tags: ['product'],
    },

    /**
     * 获取商品的实时状态（库存、价格、上下架等）
     * @param userId - 当前用户 ID，由 LLM 自动传递
     * @param productId - 商品 ID
     * @returns JSON 字符串，包含实时状态
     */
    {
      tool: tool(
        async ({
          userId,
          productId,
        }: {
          userId: string;
          productId: string;
        }) => {
          logger.log(
            `[product-tools:getProductStatus] userId="${userId}", productId="${productId}"`,
          );
          return toResultChain(treasureService.getStatus(productId))
            .then((data) => {
              const llmResult = toLLM(data, TreasureStatusDto, 'en');
              return JSON.stringify(llmResult, null, 2);
            })
            .catch(() =>
              JSON.stringify({
                error: `Unable to find product status. The product may not exist.`,
              }),
            );
        },
        {
          name: 'getProductStatus',
          schema: z.object({
            userId: z.string().describe('The current user ID'),
            productId: z.string().describe('The product ID to check status'),
          }),
          description:
            'Get real-time status of a product including stock, price, online/offline state, and whether it has expired.',
        },
      ),
      tags: ['product'],
    },

    /**
     * 获取热门商品列表
     * @param userId - 当前用户 ID，由 LLM 自动传递
     * @param limit - 返回数量，默认 10，最大 20
     * @returns JSON 字符串，包含热门商品列表
     */
    {
      tool: tool(
        async ({ userId, limit }: { userId: string; limit?: number }) => {
          const take = Math.min(Number(limit) || 10, 20);
          return toResultChain(treasureService.getHotGroups(take, userId))
            .then((data) => {
              const llmList = (data ?? []).map((item: any) =>
                toLLM(item, HotGroupItemDto, 'en'),
              );
              return toolSuccess({ products: llmList });
            })
            .catch((err: Error) =>
              toolFailure(`Failed to get hot products: ${err.message}`),
            );
        },
        {
          name: 'getHotProducts',
          schema: z.object({
            userId: z.string().describe('The current user ID'),
            limit: z
              .number()
              .optional()
              .default(10)
              .describe('Number of hot products to return (max 20)'),
          }),
          description:
            'Get a list of hot/trending products based on purchase activity.',
        },
      ),
      tags: ['product'],
    },

    /**
     * 获取商品分类列表
     * @param userId - 当前用户 ID，由 LLM 自动传递
     * @returns JSON 字符串，包含所有启用的商品分类
     */
    {
      tool: tool(
        async ({ userId }: { userId: string }) =>
          toResultChain(categoryService.list({ state: 1 }))
            .then((data) => {
              const categories = (data ?? []).map((c: any) => ({
                id: c.id,
                name: c.name,
              }));
              return toolSuccess({ categories });
            })
            .catch((err: Error) =>
              toolFailure(`Failed to get product categories: ${err.message}`),
            ),
        {
          name: 'getProductCategories',
          schema: z.object({
            userId: z.string().describe('The current user ID'),
          }),
          description: 'Get the list of available product categories.',
        },
      ),
      tags: ['product'],
    },
  ];
};
