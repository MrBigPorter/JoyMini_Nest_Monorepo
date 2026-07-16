/**
 * Flow Tools — 流程状态管理工具
 *
 * 提供给 Agent 调用的工具，用于管理 flowType / flowStatus / flowData。
 * 这些工具由 flowContext 注入到每个 Agent 的可用工具列表中。
 *
 * 设计原则：
 * - updateFlowData：合并键值对到 flowData（slot filling 用）
 * - updateFlowStatus：更新 flowStatus，带 FLOW_TYPE_REGISTRY 运行时校验
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { TaggedTool } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import {
  FlowStatus,
  isValidFlowStatus,
} from '@api/client/ai-customer/graph/types/flow-types';
import { toolSuccess, toolFailure } from './tool-result';

/**
 * 创建 Flow 状态管理工具
 *
 * 这些工具不依赖外部服务，完全基于内存状态操作。
 * 它们被标记为 'flow' 标签，注入到每个 Agent 的工具列表中。
 */
export const createFlowTools = (): TaggedTool[] => {
  return [
    /**
     * 更新流程数据（slot filling）
     *
     * 当 Agent 收集到用户提供的信息时，调用此工具将数据写入 flowData。
     * 例如：取款流程中，用户提供金额 → updateFlowData({ amount: "500" })
     *
     * @param data - 要合并到 flowData 的键值对
     */
    {
      tool: tool(
        async ({ data }: { data: Record<string, any> }) => {
          const keys = Object.keys(data);
          return toolSuccess({
            ok: true,
            message: `flowData updated with keys: ${keys.join(', ')}`,
            keys,
          });
        },
        {
          name: 'updateFlowData',
          description:
            'Update the flow data with key-value pairs. Use this to store information collected from the user during a form-filling process (slot filling). For example, in a withdrawal flow, call updateFlowData({ amount: "500", account: "GCash" }) to save the collected information. The data will be merged with existing flow data.',
          schema: z.object({
            data: z
              .record(z.any())
              .describe(
                'Key-value pairs to merge into flowData. Example: { "amount": "500", "account": "GCash" }',
              ),
          }),
        },
      ),
      displayName: 'Updating...',
      tags: ['flow'],
    },

    /**
     * 更新流程状态
     *
     * Agent 在流程推进时调用此工具更新 flowStatus。
     * 例如：取款流程从 FILLING → CONFIRMING（用户确认）→ COMPLETED
     *
     * ⚠️ 校验规则：
     * - 仅允许当前 flowType 的 allowedStatuses 中定义的状态
     * - 非法状态转换将被拒绝并返回错误信息
     *
     * @param flowType - 当前流程类型
     * @param flowStatus - 目标流程状态
     */
    {
      tool: tool(
        async ({
          flowType,
          flowStatus,
        }: {
          flowType: string;
          flowStatus: string;
        }) => {
          // 运行时校验
          if (!isValidFlowStatus(flowType as any, flowStatus as FlowStatus)) {
            return toolFailure(
              `Invalid flowStatus "${flowStatus}" for flowType "${flowType}". ` +
                `Allowed statuses depend on the current business type. ` +
                `Please check the flow type and try again.`,
            );
          }
          return toolSuccess({
            ok: true,
            message: `Flow status updated to ${flowStatus} (type: ${flowType})`,
            flowType,
            flowStatus,
          });
        },
        {
          name: 'updateFlowStatus',
          description:
            'Update the flow status of the current business process. Use this to advance the workflow state machine. For example: FILLING → CONFIRMING → COMPLETED. The system validates that the new status is allowed for the current business type.',
          schema: z.object({
            flowType: z
              .string()
              .describe(
                'The current flow type (e.g., DEPOSIT, WITHDRAWAL, COUPON_CLAIM, BALANCE_QUERY, ORDER_QUERY, COUPON_QUERY, POLICY, GENERAL)',
              ),
            flowStatus: z
              .string()
              .describe(
                'The target flow status (e.g., IDLE, FILLING, CONFIRMING, QUERYING, COMPLETED, FAILED)',
              ),
          }),
        },
      ),
      displayName: 'Updating...',
      tags: ['flow'],
    },
  ];
};
