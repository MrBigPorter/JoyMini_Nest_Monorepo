/**
 * "纯函数" 工厂：创建钱包 + KYC 查询 + 提现操作工具
 *
 * 当前工具：
 *   1. getWalletBalance      — 查询余额
 *   2. requestWithdrawOtp    — 请求提现 OTP
 *   3. verifyWithdrawOtp     — 校验提现 OTP
 *   4. getWalletTransactions — 查询充值/提现记录
 *   5. getKycStatus          — 查询实名认证状态
 *   6. getPaymentChannels    — 查询提现渠道
 *   7. applyWithdraw         — 申请提现（两阶段确认）
 *
 * ── 身份边界 ──
 * userId 从请求上下文（AsyncLocalStorage）读取，不再作为 tool 参数
 * 暴露给 LLM。模型无法通过传参查询/操作别人的钱包。
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
import { CODE_TYPE, KYC_STATUS, KYC_STATUS_LABEL } from '@lucky/shared';
import { OtpService } from '@api/client/otp/otp.service';
import {
  MISSING_USER_CONTEXT,
  requireToolUserId,
} from '@api/client/ai-customer/graph/tools/tool-identity';
import { toResult, toResultChain } from '@lucky/shared';
import { PrismaService } from '@api/common/prisma/prisma.service';

/** 手机号脱敏：只保留后 4 位，绝不把完整号码回显给 LLM/用户 */
function maskPhone(phone: string): string {
  const digits = phone.trim();
  if (digits.length <= 4) return '****';
  return `****${digits.slice(-4)}`;
}

/**
 * 从服务端用户档案读取绑定手机号。
 * OTP 目标号码只能来自这里，模型传入的 phone 一律忽略。
 * 查不到（用户不存在 / 未绑定）返回 null，调用方必须 fail-closed。
 */
async function findBoundPhone(
  prisma: PrismaService,
  userId: string,
): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { phone: true },
  });
  const phone = user?.phone?.trim();
  return phone ? phone : null;
}

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
  otpService: OtpService,
  prisma: PrismaService,
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
        async () => {
          const userId = requireToolUserId('getWalletBalance');
          if (!userId) return toolFailure(MISSING_USER_CONTEXT);

          return toResultChain(walletService.balance(userId))
            .then((data) => {
              const dto = plainToInstance(WalletBalanceResponseDto, data);
              const llmResult = toLLM(dto, WalletBalanceResponseDto, 'en');
              return toolSuccess(llmResult);
            })
            .catch((err: Error) =>
              toolFailure(`Failed to query wallet balance: ${err.message}`),
            );
        },
        {
          name: 'getWalletBalance',
          schema: z.object({}),
          description:
            'Get the current user wallet balance,including real balance (cash), coin balance,frozen balance,total recharge and total withdraw.',
        },
      ),
      displayName: 'Checking your balance...',
      tags: ['wallet'],
    },
    {
      /**
       * 请求提现 OTP 验证码
       * 目标手机号由服务端根据请求上下文 userId 查询绑定号码，
       * 模型传入的任何 phone 都被忽略（防止诱导向任意号码发码）。
       */
      tool: tool(
        async () => {
          const userId = requireToolUserId('requestWithdrawOtp');
          if (!userId) return toolFailure(MISSING_USER_CONTEXT);

          const phoneResult = await toResult(findBoundPhone(prisma, userId));
          if (!phoneResult.success) {
            return toolFailure(
              `Failed to resolve bound phone: ${phoneResult.error.message}`,
            );
          }
          const phone = phoneResult.data;
          if (!phone) {
            return toolFailure(
              'No phone number is bound to this account. Please bind a phone number first.',
            );
          }

          logger.log(
            `[wallet:requestWithdrawOtp] userId="${userId}", boundPhone=${maskPhone(phone)}`,
          );

          return toResultChain(
            otpService.request({
              phone,
              codeType: CODE_TYPE.WITHDRAW,
            }),
          )
            .then(() =>
              toolSuccess({
                message: `OTP sent successfully to ${maskPhone(phone)}. Please check your phone for the verification code.`,
              }),
            )
            .catch((err: Error) =>
              toolFailure(`Failed to send OTP: ${err.message}`),
            );
        },
        {
          name: 'requestWithdrawOtp',
          schema: z.object({}),
          description:
            'Send an OTP verification code to the phone number bound to the current user account for withdrawal authorization. Call this after user confirms withdrawal details.',
        },
      ),
      displayName: 'Sending verification code...',
      tags: ['wallet'],
    },
    {
      /**
       * 校验提现 OTP
       * 手机号同样取自服务端绑定号码，模型只能提供 code。
       */
      tool: tool(
        async ({ code }: { code: string }) => {
          const userId = requireToolUserId('verifyWithdrawOtp');
          if (!userId) return toolFailure(MISSING_USER_CONTEXT);

          const phoneResult = await toResult(findBoundPhone(prisma, userId));
          if (!phoneResult.success) {
            return toolFailure(
              `Failed to resolve bound phone: ${phoneResult.error.message}`,
            );
          }
          const phone = phoneResult.data;
          if (!phone) {
            return toolFailure(
              'No phone number is bound to this account. Please bind a phone number first.',
            );
          }

          logger.log(
            `[wallet:verifyWithdrawOtp] userId="${userId}", boundPhone=${maskPhone(phone)}`,
          );

          return toResultChain(
            otpService.verify({
              phone,
              code,
              codeType: CODE_TYPE.WITHDRAW,
            }),
          )
            .then(() =>
              toolSuccess({
                verified: true,
                message: `OTP verified successfully for ${maskPhone(phone)}. You can now proceed with the withdrawal.`,
              }),
            )
            .catch((err: Error) =>
              toolFailure(`Failed to verify OTP: ${err.message}`),
            );
        },
        {
          name: 'verifyWithdrawOtp',
          schema: z.object({
            code: z.string().describe('OTP code received via SMS, 6 digits'),
          }),
          description:
            'Verify the OTP code sent to the phone number bound to the current user account for withdrawal authorization. Must call after requestWithdrawOtp.',
        },
      ),
      displayName: 'Verifying your code...',
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
          type,
          page,
          pageSize,
        }: {
          type?: string;
          page?: number;
          pageSize?: number;
        }): Promise<string> => {
          const userId = requireToolUserId('getWalletTransactions');
          if (!userId) return toolFailure(MISSING_USER_CONTEXT);

          const result: Record<string, any> = {};

          if (!type || type === 'recharge' || type === 'all') {
            const rechargeRes = await toResult(
              clientWalletService.getRechargeHistory(userId, {
                page: page ?? 1,
                pageSize: pageSize ?? 10,
              }),
            );
            if (!rechargeRes.success) {
              return toolFailure(
                `Failed to query wallet transactions: ${rechargeRes.error.message}`,
              );
            }
            result.recharges = (rechargeRes.data.list ?? []).map((item: any) =>
              toLLM(item, RechargeHistoryItemDto, 'en'),
            );
            result.rechargeTotal = rechargeRes.data.total;
          }

          if (!type || type === 'withdrawal' || type === 'all') {
            const withdrawRes = await toResult(
              clientWalletService.getWithdrawalHistory(userId, {
                page: page ?? 1,
                pageSize: pageSize ?? 10,
              }),
            );
            if (!withdrawRes.success) {
              return toolFailure(
                `Failed to query wallet transactions: ${withdrawRes.error.message}`,
              );
            }
            result.withdrawals = withdrawRes.data.list.map((item: any) =>
              toLLM(item, WithdrawalItemResponseDto, 'en'),
            );
            result.withdrawTotal = withdrawRes.data.total;
          }
          result.page = page ?? 1;
          result.pageSize = pageSize ?? 10;
          return toolSuccess(result);
        },
        {
          name: 'getWalletTransactions',
          schema: z.object({
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
      displayName: 'Checking transaction history...',
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
        async () => {
          const userId = requireToolUserId('getKycStatus');
          if (!userId) return toolFailure(MISSING_USER_CONTEXT);

          return toResultChain(kycService.getMyKyc(userId))
            .then((data) => {
              const dto = plainToInstance(KycResponseDto, data);
              const llmResult = toLLM(dto, KycResponseDto, 'en');
              return toolSuccess(llmResult);
            })
            .catch((err: Error) =>
              toolFailure(`Failed to query KYC status: ${err.message}`),
            );
        },
        {
          name: 'getKycStatus',
          schema: z.object({}),
          description: `Get the current user's KYC (Know Your Customer / identity verification) status. Returns approval status, submitted documents and risk level.`,
        },
      ),
      displayName: 'Checking KYC status...',
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
        async ({ amount }: { amount?: number }) =>
          toResultChain(paymentChannelService.getClientConfig(2))
            .then((channels) => {
              const filtered =
                amount !== undefined
                  ? channels.filter((ch: any) => {
                      const min = Number(ch.minAmount);
                      const max = Number(ch.maxAmount);
                      return amount >= min && amount <= max;
                    })
                  : channels;
              const result = filtered.map((ch: any) => {
                const llmResult = toLLM(
                  plainToInstance(PaymentConfigItemDto, ch),
                  PaymentConfigItemDto,
                  'zh',
                );
                // 问题 A: 过滤 fixedAmounts，防止 LLM 金额幻觉
                delete (llmResult as any).fixedAmounts;
                return llmResult;
              });
              return toolSuccess(result);
            })
            .catch((err: Error) =>
              toolFailure(`Failed to query payment channels: ${err.message}`),
            ),
        {
          name: 'getPaymentChannels',
          schema: z.object({
            amount: z
              .number()
              .positive()
              .optional()
              .describe('Filter channels by withdrawal amount'),
          }),
          description:
            'Get available withdrawal payment channels such as GCash, PayMaya, Bank Transfer, including fee info, min/max amounts, and channel names.',
        },
      ),
      displayName: 'Loading payment methods...',
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
          amount,
          channelId,
          account,
          accountName,
        }: {
          amount: number;
          channelId: number;
          account: string;
          accountName: string;
        }) => {
          const userId = requireToolUserId('applyWithdraw');
          if (!userId) return toolFailure(MISSING_USER_CONTEXT);

          // KYC 检查
          const kycResult = await toResult(kycService.getMyKyc(userId));
          if (!kycResult.success) {
            return toolFailure(
              `KYC not approved. Please complete identity verification first.`,
            );
          }
          const kyc = kycResult.data;
          if (!kyc || kyc.kycStatus !== KYC_STATUS.APPROVED) {
            return toolFailure(
              `KYC not approved. Please complete identity verification first. Current status: ${kyc?.kycStatus ?? 'unknown'}`,
            );
          }
          // 余额检查
          const balanceResult = await toResult(walletService.balance(userId));
          if (!balanceResult.success) {
            return toolFailure(
              `Failed to check balance: ${balanceResult.error.message}`,
            );
          }
          const balance = balanceResult.data;
          const realBalance = new Prisma.Decimal(balance.realBalance ?? '0');
          if (realBalance.lessThan(new Prisma.Decimal(amount))) {
            return toolFailure(
              `Insufficient balance. Available: ₱${realBalance.toString()}, requested: ₱${amount}`,
            );
          }
          // 幂等性检查（30秒内重复提现）
          const idKey = `${userId}:${amount}:${channelId}:${account}`;
          if (isRecentWithdraw(idKey)) {
            return toolSuccess({
              message:
                'Duplicate withdrawal request detected within 30 seconds. Please wait before trying again.',
            });
          }
          markRecentWithdraw(idKey);
          // ── 执行提现 ──
          const dto = new ApplyWithdrawDto();
          dto.amount = amount;
          dto.channelId = channelId;
          dto.account = account;
          dto.accountName = accountName;
          const orderResult = await toResult(
            clientWalletService.applyWithdraw(userId, dto),
          );
          if (!orderResult.success) {
            return toolFailure(
              `Withdrawal failed: ${orderResult.error.message}`,
            );
          }
          const dtoRes = plainToInstance(
            WithdrawApplyResponseDto,
            orderResult.data,
          );
          const llmResult = toLLM(dtoRes, WithdrawApplyResponseDto, 'en');
          return toolSuccess(llmResult);
        },
        {
          name: 'applyWithdraw',
          schema: z.object({
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
      displayName: 'Processing withdrawal...',
      capability: { kind: 'write', requiresOwnership: false },
      tags: ['wallet'],
    },
  ];
};
