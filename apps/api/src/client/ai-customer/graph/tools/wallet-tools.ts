/**
 * "纯函数" 工厂：创建钱包 + KYC 查询工具
 *
 * Phase 1 — 3 个查询工具，不包含提现操作：
 *   1. getWalletBalance   — 查询余额
 *   2. getWalletTransactions — 查询充值/提现记录
 *   3. getKycStatus       — 查询实名认证状态
 *
 * 所有返回数据通过 toLLM() 语义化，避免 LLM 看到 raw DB 字段。
 */
import { WalletService } from '@api/client/wallet/wallet.service';
import { ClientWalletService } from '@api/client/wallet/client-wallet.service';
import { KycService } from '@api/client/kyc/kyc.service';
import { TaggedTool } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { Logger } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import { toLLM } from '@api/common/ai/utils/to-llm';
import { WalletBalanceResponseDto } from '@api/client/wallet/dto/wallet-balance.response.dto';
import { z } from 'zod';
import { TransactionResponseDto } from '@api/client/wallet/dto/transaction-response.dto';
import { WithdrawalItemResponseDto } from '@api/client/wallet/dto/withdrawal-item-response.dto';
import { KycResponseDto } from '@api/client/kyc/dto/kyc.response.dto';
import { plainToInstance } from 'class-transformer';
import {
  toolFailure,
  ToolResult,
  toolSuccess,
} from '@api/client/ai-customer/graph/tools/tool-result';

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

export const createWalletTools = (
  walletService: WalletService,
  clientWalletService: ClientWalletService,
  kycService: KycService,
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
                toLLM(item, TransactionResponseDto, 'zh'),
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
  ];
};
