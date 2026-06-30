import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { plainToInstance } from 'class-transformer';
import { ClientCouponService } from '@api/client/coupon/coupon.service';
import { toLLM } from '@api/common/ai/utils/to-llm';
import { MyCouponResponseDto } from '@api/client/coupon/dto/my-coupon-response-dto';
import { ClaimableCouponResponseDto } from '@api/client/coupon/dto/claimable-coupon-response.dto';
import { Logger } from '@nestjs/common';
import { TaggedTool } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import {
  toolFailure,
  toolSuccess,
} from '@api/client/ai-customer/graph/tools/tool-result';

/**
 * "纯函数" 工厂：创建优惠券查询/领取工具
 * @param couponService - 从 NestJS DI 注入的 ClientCouponService
 *
 * userId 由 LLM 通过 tool 参数自动传递（方案A）
 */
export const createCouponTools = (
  couponService: ClientCouponService,
): TaggedTool[] => {
  const logger = new Logger('CouponTools');

  return [
    /**
     * 获取当前用户的优惠券列表
     * @param userId - 当前用户 ID，由 LLM 自动传递
     * @param status - 优惠券状态：0=未使用, 1=已使用, 2=已过期
     * @param page - 分页页码，默认 1
     * @param pageSize - 分页大小，默认 10
     */
    {
      tool: tool(
        async ({
          userId,
          status,
          page,
          pageSize,
        }: {
          userId: string;
          status?: number;
          page?: number;
          pageSize?: number;
        }) => {
          try {
            const result = await couponService.getMyCoupons(userId, {
              status,
              page: page ?? 1,
              pageSize: pageSize ?? 10,
            });
            const llmList = (result.list ?? []).map((item: any) =>
              toLLM(
                plainToInstance(MyCouponResponseDto, item),
                MyCouponResponseDto,
                'zh',
              ),
            );
            return toolSuccess({
              total: result.total,
              page: result.page,
              pageSize: result.pageSize,
              coupons: llmList,
            });
          } catch (e) {
            return toolFailure(
              `Failed to query coupons: ${(e as Error).message}`,
            );
          }
        },
        {
          name: 'getUserCoupons',
          schema: z.object({
            userId: z.string().describe('The current user ID'),
            status: z
              .number()
              .optional()
              .describe(
                'Coupon status filter: 0=unused, 1=used, 2=expired. Omit for all.',
              ),
            page: z.number().optional().default(1),
            pageSize: z.number().optional().default(10),
          }),
          description:
            "Get the current user's coupon list. Can filter by status: 0=unused, 1=used, 2=expired.",
        },
      ),
      tags: ['coupon'],
    },
    /**
     * 领取/申领一张优惠券
     * @param userId - 当前用户 ID
     * @param couponId - 优惠券模板 ID
     */
    {
      tool: tool(
        async ({ userId, couponId }: { userId: string; couponId: string }) => {
          try {
            logger.log(
              `[coupon-tools:claimCoupon] userId="${userId}", couponId="${couponId}"`,
            );
            const result = await couponService.claimCoupon(userId, couponId, 2);
            return toolSuccess({
              userCouponId: result.id,
              status: result.status,
              message: 'Successfully claimed the coupon',
            });
          } catch (e) {
            return toolFailure(
              `Failed to claim coupon: ${(e as Error).message}`,
            );
          }
        },
        {
          name: 'claimCoupon',
          schema: z.object({
            userId: z.string().describe('The current user ID'),
            couponId: z.string().describe('The coupon template ID to claim'),
          }),
          description:
            'Claim/collect a coupon by coupon template ID. The coupon must be available for manual claiming.',
        },
      ),
      tags: ['coupon'],
    },
    /**
     * 兑换码兑换优惠券
     * @param userId - 当前用户 ID
     * @param code - 兑换码
     */
    {
      tool: tool(
        async ({ userId, code }: { userId: string; code: string }) => {
          try {
            logger.log(
              `[coupon-tools:redeemCode] userId="${userId}", code="${code}"`,
            );
            await couponService.redeemCode(userId, code);
            return toolSuccess({
              success: true,
              message: 'Successfully redeemed the coupon code',
            });
          } catch (e) {
            return toolFailure(
              `Failed to redeem code: ${(e as Error).message}`,
            );
          }
        },
        {
          name: 'redeemCouponCode',
          schema: z.object({
            userId: z.string().describe('The current user ID'),
            code: z.string().describe('The redeem/coupon code to redeem'),
          }),
          description:
            'Redeem a coupon code to claim a specific coupon. The code is case-insensitive.',
        },
      ),
      tags: ['coupon'],
    },
    /**
     * 获取可领取的优惠券列表（领券中心）
     * @param userId - 当前用户 ID
     */
    {
      tool: tool(
        async ({ userId }: { userId: string }) => {
          try {
            const result = await couponService.getClaimableCoupons(userId);
            const llmList = (result ?? []).map((item: any) =>
              toLLM(
                plainToInstance(ClaimableCouponResponseDto, item),
                ClaimableCouponResponseDto,
                'zh',
              ),
            );
            return toolSuccess({
              coupons: llmList,
              total: llmList.length,
            });
          } catch (e) {
            return toolFailure(
              `Failed to get claimable coupons: ${(e as Error).message}`,
            );
          }
        },
        {
          name: 'getClaimableCoupons',
          schema: z.object({
            userId: z.string().describe('The current user ID'),
          }),
          description:
            'Get the list of coupons available for claiming (coupon center). Only active coupons (status=1) are shown.',
        },
      ),
      tags: ['coupon'],
    },
  ];
};
