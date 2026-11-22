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
import {
  MISSING_USER_CONTEXT,
  requireToolUserId,
} from '@api/client/ai-customer/graph/tools/tool-identity';
import { toResultChain } from '@lucky/shared';

/**
 * "纯函数" 工厂：创建优惠券查询/领取工具
 * @param couponService - 从 NestJS DI 注入的 ClientCouponService
 *
 * ── 身份边界（重要）──
 * userId 不再由 LLM 通过 tool 参数传递，也不在启动时绑定。
 * 工具是全局单例，每次调用从 AsyncLocalStorage 请求上下文读取
 * "当前登录用户"；模型即使伪造 userId 参数，也查不到别人的数据。
 *
 * 为什么不能在工厂里传一个固定 ctx：
 * 工具在应用启动时一次性注册，如果启动时绑定 userId，
 * 所有并发用户会共用同一个身份。
 */
export const createCouponTools = (
  couponService: ClientCouponService,
): TaggedTool[] => {
  const logger = new Logger('CouponTools');

  return [
    /**
     * 获取当前用户的优惠券列表
     * @param status - 优惠券状态：0=未使用, 1=已使用, 2=已过期
     * @param page - 分页页码，默认 1
     * @param pageSize - 分页大小，默认 10
     */
    {
      tool: tool(
        async ({
          status,
          page,
          pageSize,
        }: {
          status?: number;
          page?: number;
          pageSize?: number;
        }) => {
          const userId = requireToolUserId('getUserCoupons');
          if (!userId) return toolFailure(MISSING_USER_CONTEXT);

          return toResultChain(
            couponService.getMyCoupons(userId, {
              // 默认只看未使用：过期/已用券不应主动出现在「我的券」里，
              // 用户明确问“过期的券/用过的券”时才由模型传 status。
              status: status ?? 0,
              page: page ?? 1,
              pageSize: pageSize ?? 10,
            }),
          )
            .then((result) => {
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
            })
            .catch((err) =>
              toolFailure(`Failed to query coupons: ${err.message}`),
            );
        },
        {
          name: 'getUserCoupons',
          schema: z.object({
            status: z
              .number()
              .optional()
              .describe(
                'Coupon status filter: 0=unused (default), 1=used, 2=expired. Omit to show unused only; pass 2 only when the user explicitly asks for expired coupons.',
              ),
            page: z.number().optional().default(1),
            pageSize: z.number().optional().default(10),
          }),
          description:
            "Get the current user's coupon list. Defaults to unused coupons (status=0). Pass status=1 for used or status=2 for expired only when the user explicitly asks.",
        },
      ),
      displayName: 'Looking up your coupons...',
      tags: ['coupon'],
    },
    /**
     * 领取/申领一张优惠券
     * @param couponId - 优惠券模板 ID
     */
    {
      tool: tool(
        async ({ couponId }: { couponId: string }) => {
          const userId = requireToolUserId('claimCoupon');
          if (!userId) return toolFailure(MISSING_USER_CONTEXT);

          logger.log(
            `[coupon-tools:claimCoupon] userId="${userId}", couponId="${couponId}"`,
          );

          return toResultChain(couponService.claimCoupon(userId, couponId, 2))
            .then((result) =>
              toolSuccess({
                userCouponId: result.id,
                status: result.status,
                message: 'Successfully claimed the coupon',
              }),
            )
            .catch((err) =>
              toolFailure(`Failed to claim coupon: ${err.message}`),
            );
        },
        {
          name: 'claimCoupon',
          schema: z.object({
            couponId: z.string().describe('The coupon template ID to claim'),
          }),
          description:
            'Claim/collect a coupon by coupon template ID. The coupon must be available for manual claiming.',
        },
      ),
      displayName: 'Claiming coupon...',
      capability: { kind: 'write', requiresOwnership: false },
      tags: ['coupon'],
    },
    /**
     * 兑换码兑换优惠券
     * @param code - 兑换码
     */
    {
      tool: tool(
        async ({ code }: { code: string }) => {
          const userId = requireToolUserId('redeemCouponCode');
          if (!userId) return toolFailure(MISSING_USER_CONTEXT);

          // 兑换码是 bearer secret：日志只记长度，不落明文。
          logger.log(
            `[coupon-tools:redeemCode] userId="${userId}", codeLength=${code.length}`,
          );

          return toResultChain(couponService.redeemCode(userId, code))
            .then(() =>
              toolSuccess({
                success: true,
                message: 'Successfully redeemed the coupon code',
              }),
            )
            .catch((err) =>
              toolFailure(`Failed to redeem code: ${err.message}`),
            );
        },
        {
          name: 'redeemCouponCode',
          schema: z.object({
            code: z.string().describe('The redeem/coupon code to redeem'),
          }),
          description:
            'Redeem a coupon code to claim a specific coupon. The code is case-insensitive.',
        },
      ),
      displayName: 'Redeeming coupon code...',
      capability: { kind: 'write', requiresOwnership: false },
      tags: ['coupon'],
    },
    /**
     * 获取可领取的优惠券列表（领券中心）
     */
    {
      tool: tool(
        async ({ includeUnavailable }: { includeUnavailable?: boolean }) => {
          const userId = requireToolUserId('getClaimableCoupons');
          if (!userId) return toolFailure(MISSING_USER_CONTEXT);

          return toResultChain(couponService.getClaimableCoupons(userId))
            .then((result) => {
              // 默认只返回“现在真的能领”的券：
              // 已达上限/抢光的券不展示，避免用户看到一串点不了的选项。
              const visible = includeUnavailable
                ? (result ?? [])
                : (result ?? []).filter((item: any) => item.canClaim !== false);
              const llmList = visible.map((item: any) =>
                toLLM(
                  plainToInstance(ClaimableCouponResponseDto, {
                    ...item,
                    currency: item.currency ?? 'PHP',
                  }),
                  ClaimableCouponResponseDto,
                  'zh',
                ),
              );
              return toolSuccess({
                coupons: llmList,
                total: llmList.length,
              });
            })
            .catch((err) =>
              toolFailure(`Failed to get claimable coupons: ${err.message}`),
            );
        },
        {
          name: 'getClaimableCoupons',
          schema: z.object({
            includeUnavailable: z
              .boolean()
              .optional()
              .describe(
                'When true, also include coupons the user cannot claim (limit reached/sold out). Use only when the user asks why a coupon is unavailable.',
              ),
          }),
          description:
            'Get coupons the user can claim right now. Unclaimable coupons are hidden unless includeUnavailable=true.',
        },
      ),
      displayName: 'Finding available coupons...',
      tags: ['coupon'],
    },
  ];
};
