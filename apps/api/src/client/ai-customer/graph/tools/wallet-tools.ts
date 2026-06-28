/**
 * "纯函数" 工厂：创建钱包 + KYC 查询 + 提现操作工具
 *
 * 当前工具：
 *   1. getWalletBalance      — 查询余额
 *   2. getWalletTransactions — 查询充值/提现记录
 *   3. getKycStatus          — 查询实名认证状态
 *   4. getPaymentChannels    — 查询提现渠道
 *   5. applyWithdraw         — 申请提现（两阶段确认）
 *
 * 所有返回数据通过 toLLM() 语义化，避免 LLM 看到 raw DB 字段。
 */
import { WalletService } from '@api/client/wallet/wallet.service';
import { ClientWalletService } from '@api/client/wallet/client-wallet.service';
import { KycService } from '@api/client/kyc/kyc.service';
import { PaymentChannelService } from '@api/common/payment-channel/payment-channel.service';
import { TaggedTool } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { Logger } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import { toLLM } from '@api/common/ai/utils/to-llm';
import { WalletBalanceResponseDto } from '@api/client/wallet/dto/wallet-balance.response.dto';
import { z } from 'zod';
import { RechargeHistoryItemDto } from '@api/client/wallet/dto/recharge.dto';
import { WithdrawalItemResponseDto } from '@api/client/wallet/dto/withdrawal-item-response.dto';
import { WithdrawApplyResponseDto } from '@api/client/wallet/dto/withdraw-apply-response.dto';
import { PaymentConfigItemDto } from '@api/client/payment-channel/dto/payment-channel.dto';
import { ApplyWithdrawDto } from '@api/client/wallet/dto/apply-withdraw.dto';
import { KycResponseDto } from '@api/client/kyc/dto/kyc.response.dto';
import { plainToInstance } from 'class-transformer';
import { Prisma } from '@prisma/client';
import {
  toolFailure,
  ToolResult,
  toolSuccess,
} from '@api/client/ai-customer/graph/tools/tool-result';
import { KYC_STATUS, KYC_STATUS_LABEL } from '@lucky/shared';

/** getWalletBalance 返回数据 */
interface BalanceData {
  realBalance: string;
  coinBalance: string;
  frozenBalance: string;
  totalRecharge: string;
  totalWithdraw: string;
}

/** 单条交易/提现记录（toLLM 产出 flat key-value） */
interface RawRecord {
  [key: string]: any;
}

/** getWalletTransactions 返回数据 */
interface TransactionsData {
  recharges?: RawRecord[];
  withdrawals?: RawRecord[];
  rechargeTotal?: number;
  withdrawTotal?: number;
  page: number;
  pageSize: number;
}

/** getKycStatus 返回数据 */
type KycStatusData = Record<string, any>;

/**
 * 简单的内存幂等性检查，防止 30s 内重复提现
 */
const recentWithdraws = new Set<string>();
const WITHDRAW_COOLDOWN_MS = 30_000;

function isRecentWithdraw(key: string): boolean {
  return recentWithdraws.has(key);
}

function markRecentWithdraw(key: string): void {
  recentWithdraws.add(key);
  setTimeout(() => recentWithdraws.delete(key), WITHDRAW_COOLDOWN_MS);
}

export const createWalletTools = (
  walletService: WalletService,
  clientWalletService: ClientWalletService,
  kycService: KycService,
  paymentChannelService: PaymentChannelService,
): TaggedTool[] => {
  const logger = new Logger('walletTools');
  return [
    {
      /**
       * 查询钱包余额
       * 1. realBalance — 现金余额（可提现）
       * 2. coinBalance — 虚拟币余额（不可提现）
       * 3. frozenBalance — 冻结金额（提现中）
       * 4. totalRecharge — 累计充值金额
       * 5. totalWithdraw — 累计提现金额
       */
      tool: tool(
        async ({ userId }: { userId: string }) => {
          try {
            const result = await walletService.balance(userId);
            const dto = plainToInstance(WalletBalanceResponseDto, result);
            const llmResult = toLLM(dto, WalletBalanceResponseDto, 'zh');
            return toolSuccess(llmResult);
          } catch (e) {
            return toolFailure(
              `Failed to query wallet balance: ${(e as Error).message}`,
            );
          }
        },
        {
          name: 'getWalletBalance',
          schema: z.object({
            userId: z.string().describe('The Current user ID'),
          }),
          description:
            'Get the current user wallet balance,including real balance (cash), coin balance,frozen balance,total recharge and total withdraw.',
        },
      ),
      tags: ['wallet'],
    },
    {
      /**
       * 查询钱包充值/提现记录
       *  1. recharges — 充值记录列表
       *  2. withdrawals — 提现记录列表
       *  3. rechargeTotal — 充值总数
       *  4. withdrawTotal — 提现总数
       *  5. page — 当前页码
       *  6. pageSize — 每页数量
       */
      tool: tool(
        async ({
          userId,
          type,
          page,
          pageSize,
        }: {
          userId: string;
          type?: string;
          page?: number;
          pageSize?: number;
        }): Promise<string> => {
          try {
            const result: Record<string, any> = {};

            if (!type || type === 'recharge' || type === 'all') {
              const rechargeRes = await clientWalletService.getRechargeHistory(
                userId,
                {
                  page: page ?? 1,
                  pageSize: pageSize ?? 10,
                },
              );
              result.recharges = (rechargeRes.list ?? []).map((item: any) =>
                toLLM(item, RechargeHistoryItemDto, 'zh'),
              );
              result.rechargeTotal = rechargeRes.total;
            }

            if (!type || type === 'withdrawal' || type === 'all') {
              const withdrawRes =
                await clientWalletService.getWithdrawalHistory(userId, {
                  page: page ?? 1,
                  pageSize: pageSize ?? 10,
                });
              result.withdrawals = withdrawRes.list.map((item: any) =>
                toLLM(item, WithdrawalItemResponseDto, 'zh'),
              );
              result.withdrawTotal = withdrawRes.total;
            }
            result.page = page ?? 1;
            result.pageSize = pageSize ?? 10;
            return toolSuccess(result);
          } catch (e) {
            return toolFailure(
              `Failed to query wallet transactions: ${(e as Error).message}`,
            );
          }
        },
        {
          name: 'getWalletTransactions',
          schema: z.object({
            userId: z.string().describe('The Current user ID'),
            type: z
              .enum(['recharge', 'withdrawal', 'all'])
              .optional()
              .default('all')
              .describe(
                'Type of transactions to query: recharge, withdrawal, or all',
              ),
            page: z
              .number()
              .optional()
              .default(1)
              .describe('Page number for pagination'),
            pageSize: z
              .number()
              .optional()
              .default(10)
              .describe('Number of records per page for pagination'),
          }),
          description:
            "Get the current user's wallet trascation history,including recharge (deposit) and withdraw ((cash-out)) records.",
        },
      ),
      tags: ['wallet'],
    },
    {
      /**
       * 查询用户 KYC（实名认证）状态
       *  1. status — KYC 审核状态（pending / approved / rejected）
       *  2. documents — 已提交的 KYC 文件列表
       *  3. riskLevel — 风险等级（low / medium / high）
       */
      tool: tool(
        async ({ userId }: { userId: string }) => {
          try {
            const result = await kycService.getMyKyc(userId);
            const dto = plainToInstance(KycResponseDto, result);
            const llmResult = toLLM(dto, KycResponseDto, 'zh');
            return toolSuccess(llmResult);
          } catch (e) {
            return toolFailure(
              `Failed to query KYC status: ${(e as Error).message}`,
            );
          }
        },
        {
          name: 'getKycStatus',
          schema: z.object({
            userId: z.string().describe('The Current user ID'),
          }),
          description: `Get the current user's KYC (Know Your Customer / identity verification) status. Returns approval status, submitted documents and risk level.`,
        },
      ),
      tags: ['wallet'],
    },
    {
      /**
       * 查询可用提现渠道（如 GCash、PayMaya、银行转账），包括手续费、最小/最大金额、渠道名称等信息
       *  1. channelId — 渠道 ID
       *  2. channelName — 渠道名称
       *  3. minAmount — 最小提现金额
       *  4. maxAmount — 最大提现金额
       *  5. feeRate — 手续费率（百分比）
       *  6. fixedFee — 固定手续费（金额）
       *  7. currency — 币种
       *  8. description — 渠道描述
       */
      tool: tool(
        async ({ userId, amount }: { userId: string; amount?: number }) => {
          try {
            const channels = await paymentChannelService.getClientConfig(2);
            const filtered =
              amount !== undefined
                ? channels.filter((ch) => {
                    const min = Number(ch.minAmount);
                    const max = Number(ch.maxAmount);
                    return amount >= min && amount <= max;
                  })
                : channels;
            const result = filtered.map((ch) =>
              toLLM(
                plainToInstance(PaymentConfigItemDto, ch),
                PaymentConfigItemDto,
                'zh',
              ),
            );
            return toolSuccess(result);
          } catch (e) {
            return toolFailure(
              `Failed to query payment channels: ${(e as Error).message}`,
            );
          }
        },
        {
          name: 'getPaymentChannels',
          schema: z.object({
            userId: z.string().describe('The Current user ID'),
          }),
          description:
            'Get available withdrawal payment channels such as GCash, PayMaya, Bank Transfer, including fee info, min/max amounts, and channel names.',
        },
      ),
      tags: ['wallet'],
    },
    {
      /**
       * 申请提现（两阶段确认）
       *  1. amount — 提现金额
       *  2. channelId — 提现渠道 ID
       *  3. account — 提现账户（如 GCash 手机号）
       *  4. accountName — 提现账户持有人姓名
       *  5. userId — 当前用户 ID
       */
      tool: tool(
        async ({
          userId,
          amount,
          channelId,
          account,
          accountName,
        }: {
          userId: string;
          amount: number;
          channelId: number;
          account: string;
          accountName: string;
        }) => {
          try {
            // kYC 检查
            const kyc = await kycService.getMyKyc(userId);
            if (!kyc || kyc.kycStatus !== KYC_STATUS.APPROVED) {
              return toolFailure(
                `KYC not approved. Please complete identity verification first. Current status: ${kyc?.kycStatus} ?? 'unknown'}`,
              );
            }
            //余额检查
            const balance = await walletService.balance(userId);
            const realBalance = new Prisma.Decimal(balance.realBalance ?? '0');
            if (realBalance.lessThan(new Prisma.Decimal(amount))) {
              return toolFailure(
                `Insufficient balance. Available: ₱${realBalance.toString()}, requested: ₱${amount}`,
              );
            }
            //幂等性检查（30秒内重复提现）
            const idKey = `${userId}:${amount}:${channelId}:${account}`;
            if (isRecentWithdraw(idKey)) {
              return toolSuccess({
                message:
                  'Duplicate withdrawal request detected within 30 seconds. Please wait before trying again.',
              });
            }
            markRecentWithdraw(idKey);
            // ── 4. 执行提现 ──
            const dto = new ApplyWithdrawDto();
            dto.amount = amount;
            dto.channelId = channelId;
            dto.account = account;
            dto.accountName = accountName;
            const order = await clientWalletService.applyWithdraw(userId, dto);
            const dtoRes = plainToInstance(WithdrawApplyResponseDto, order);
            const llmResult = toLLM(dtoRes, WithdrawApplyResponseDto, 'zh');
            return toolSuccess(llmResult);
          } catch (e) {
            return toolFailure(`Withdrawal failed: ${(e as Error).message}`);
          }
        },
        {
          name: 'applyWithdraw',
          schema: z.object({
            userId: z.string().describe('The Current user ID'),
            amount: z.number().positive().describe('Withdrawal amount in PHP'),
            channelId: z
              .number()
              .int()
              .positive()
              .describe('Payment channel ID from getPaymentChannels'),
            account: z
              .string()
              .describe('Withdrawal account number e.g. GCash mobile number'),
            accountName: z.string().describe('Account holder name'),
          }),
          description: `Submit a withdrawal request. IMPORTANT: 1. Always call getPaymentChannels first to let user choose a channel. 2. Present a preview with estimated fee. 3. Must get user explicit confirmation before calling this tool. 4. Verify KYC and balance first.`,
        },
      ),
      tags: ['wallet'],
    },
  ];
};
