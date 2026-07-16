/**
 * kyc-tools — KYC Agent 的工具定义
 *
 * ═══════════════════════════════════════════════════════════════
 * 📖 一句话解释
 * ═══════════════════════════════════════════════════════════════
 *
 * 给 LLM 提供"KYC 认证"相关的查询工具。
 * 用户问"我的 KYC 认证状态"、"支持哪些证件类型"时，
 * LLM 通过这些工具查真实数据。
 *
 * 注意：KYC Agent 是"只读 + 引导"的！
 *   它只能查 KYC 状态和证件类型，不能提交资料。
 *   提交资料需要用户去 App 内 KYC 页面完成（涉及文件上传）。
 *
 *
 * ═══════════════════════════════════════════════════════════════
 * 🚀 2 个工具速览
 * ═══════════════════════════════════════════════════════════════
 *
 * ┌──────────────────┬──────────┬──────────────────────────────┐
 * │ 工具名称          │ 读写     │ 用途                         │
 * ├──────────────────┼──────────┼──────────────────────────────┤
 * │ ① getKycDetail   │ 只读     │ 查看用户的完整 KYC 认证信息   │
 * │ ② getIdTypes     │ 只读     │ 查看平台支持的证件类型列表     │
 * └──────────────────┴──────────┴──────────────────────────────┘
 *
 *
 * ═══════════════════════════════════════════════════════════════
 * 🏷️ 标签策略
 * ═══════════════════════════════════════════════════════════════
 *
 * 独立 tag 'kyc'，与 wallet 分开。
 * 这样当意图分类为 kyc 时，只给 KYC Agent 提供这两个工具。
 * wallet Agent 仍然保留 getKycStatus（通过 wallet tag），
 * 但当用户明确问 KYC 问题时，走专门的 KYC Agent 更准确。
 *
 * ── 为什么 wallet 和 kyc 分开？ ──
 * 1. 职责单一：wallet 负责资金，kyc 负责认证
 * 2. KYC 有独立的知识和逻辑（证件类型、认证流程、OCR）
 * 3. 方便未来扩展（如 KYC 升级、新增证件类型）不影响 wallet
 * 4. DEPENDENCY_MAP: wallet → kyc（提现前检查 KYC）
 *
 *
 * ═══════════════════════════════════════════════════════════════
 * 🔧 与 wallet-tools.ts 的关系
 * ═══════════════════════════════════════════════════════════════
 *
 * wallet-tools.ts 已有 getKycStatus（简化版，返回 status + reason）。
 * kyc-tools.ts 的 getKycStatus 更详细（返回完整 KYC 记录）。
 *
 * 两个工具并存的原因是：
 * - wallet 场景：用户问钱包相关时，wallet Agent 可以快速查 KYC 状态
 *   （如提现前检查："您的 KYC 尚未完成，请先认证"）
 * - kyc 场景：用户专门问 KYC 时，KYC Agent 提供完整信息
 *   （包括证件类型、认证时间、审核意见等）
 *
 * 未来可以优化：wallet 的 getKycStatus 简化为 isKycApproved boolean。
 */

import { KycService } from '@api/client/kyc/kyc.service';
import { KycResponseDto } from '@api/client/kyc/dto/kyc.response.dto';
import { KycIdTypesResponseDto } from '@api/client/kyc/dto/kyc-id-types.response.dto';
import { toLLM } from '@api/common/ai/utils/to-llm';
import { plainToInstance } from 'class-transformer';
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
 * 创建 KYC Agent 的所有工具
 *
 * @param kycService  - KYC 领域服务（状态查询、证件类型）
 * @returns TaggedTool[] - 2 个标记好标签的工具
 */
export const createKycTools = (kycService: KycService): TaggedTool[] => {
  const logger = new Logger('KycTools');

  return [
    // ================================================================
    // ① getKycDetail — 查看用户的完整 KYC 认证信息
    //   (renamed from getKycStatus to avoid name collision with wallet-tools)
    // ================================================================
    {
      tool: tool(
        async ({ userId }: { userId: string }) => {
          logger.log(`[kyc-tools:getKycDetail] userId="${userId}"`);
          return toResultChain(kycService.getMyKyc(userId))
            .then((result) => {
              const dto = plainToInstance(KycResponseDto, result);
              const llmResult = toLLM(dto, KycResponseDto, 'en');
              return toolSuccess(llmResult);
            })
            .catch((err) =>
              toolFailure(`Failed to get KYC detail: ${err.message}`),
            );
        },
        {
          name: 'getKycDetail',
          schema: z.object({
            userId: z.string().describe('The current user ID'),
          }),
          description:
            'Check the user KYC (real-name verification) status. Returns: kycStatus (0=draft/not-submitted, 1=pending-review, 2=approved, 3=rejected), idType, riskLevel, and timestamps. Use this to answer user questions about their KYC verification progress.',
        },
      ),
      displayName: 'Checking verification status...',
      tags: ['kyc'],
    },

    // ================================================================
    // ② getIdTypes — 查看平台支持的证件类型列表
    // ================================================================
    {
      tool: tool(
        async () => {
          logger.log(`[kyc-tools:getIdTypes]`);
          return toResultChain(kycService.getIdTypes())
            .then((result) => {
              const idTypes = result.map((item: any) =>
                toLLM(
                  plainToInstance(KycIdTypesResponseDto, item),
                  KycIdTypesResponseDto,
                  'en',
                ),
              );
              return toolSuccess({ idTypes });
            })
            .catch((err) =>
              toolFailure(`Failed to get ID types: ${err.message}`),
            );
        },
        {
          name: 'getIdTypes',
          schema: z.object({}),
          description:
            'View the supported ID/document types for KYC verification. Returns a list of ID types (e.g., Passport, Driver License, National ID) that the platform accepts for real-name verification.',
        },
      ),
      displayName: 'Loading ID types...',
      tags: ['kyc'],
    },
  ];
};
