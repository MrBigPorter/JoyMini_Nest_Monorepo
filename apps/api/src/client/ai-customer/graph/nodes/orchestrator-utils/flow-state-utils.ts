import { AgentState } from '@api/client/ai-customer/graph/state';
import { FlowDataAccumulator } from '@api/client/ai-customer/graph/agents/agent-runner';
import {
  FLOW_TYPE_REGISTRY,
  FlowStatus,
  FlowType,
  getTaskType,
  intentToFlowType,
  isValidFlowStatus,
} from '@api/client/ai-customer/graph/types/flow-types';

export interface ResolvedFlowState {
  activeFlow: FlowType;
  step: FlowStatus;
  data: Record<string, any>;
}

/**
 * 把当前意图映射为 FlowType。
 *
 * intentToFlowType 只覆盖 order/wallet/coupon/rag/general；
 * product/user/kyc/lucky-draw 等路由标签没有独立业务流程，归入 GENERAL。
 */
export function resolveTargetFlowType(
  intent: string,
  labels: { label: string }[] = [],
): FlowType {
  const source = intent || labels[0]?.label || '';
  const mapped = intentToFlowType(source);
  return mapped || (source ? 'GENERAL' : '');
}

/**
 * 从 state.flowState 创建本轮的 accumulator。
 *
 * 只在同一 FlowType 且流程未结束时保留 data：
 *   - 上轮 WITHDRAWAL/FILLING + 本轮仍是 wallet → 保留已填金额
 *   - 换成 order，或上轮已 COMPLETED/FAILED → 清空，避免跨流程串数据
 */
export function createFlowAccumulator(
  state: typeof AgentState.State,
): FlowDataAccumulator {
  const old = state.flowState;
  const target = resolveTargetFlowType(state.intent, state.labels);

  const oldType = (old?.activeFlow || '') as FlowType;
  const oldStep = (old?.step || '') as FlowStatus;
  // wallet 意图会细化为 DEPOSIT/WITHDRAWAL/BALANCE_QUERY，
  // 不能因为细化后的类型与粗映射不同就把已填数据丢掉。
  const sameFamily =
    oldType !== '' && flowFamily(oldType) === flowFamily(target);
  const stillOpen = oldStep !== 'COMPLETED' && oldStep !== 'FAILED';
  const preserve = sameFamily && stillOpen;

  return {
    flowData: preserve ? { ...(old?.data ?? {}) } : {},
    flowType: preserve ? oldType : target || oldType || undefined,
    flowStatus: preserve && oldStep ? oldStep : undefined,
  };
}

/**
 * 流水线结束后生成完整的 flowState。
 *
 * 工具没写状态时按任务类型给默认值：
 *   - form（充值/取款/领券）→ FILLING，等待下一轮继续
 *   - query（余额/订单/优惠券/政策/闲聊）→ COMPLETED
 *
 * Agent 显式写入的 flowType/flowStatus 优先，但必须通过 registry 校验。
 */
export function finalizeFlowState(
  accumulator: FlowDataAccumulator | undefined,
  targetType: FlowType,
  options: { forceStep?: FlowStatus } = {},
): ResolvedFlowState {
  const activeFlow = (accumulator?.flowType ||
    targetType ||
    'GENERAL') as FlowType;
  const explicitStatus = accumulator?.flowStatus;

  let step: FlowStatus;
  if (options.forceStep) {
    step = options.forceStep;
  } else if (explicitStatus && isValidFlowStatus(activeFlow, explicitStatus)) {
    step = explicitStatus;
  } else {
    const taskType = getTaskType(activeFlow);
    step = taskType === 'form' ? 'FILLING' : 'COMPLETED';
  }

  // '' 只允许 IDLE（registry 约定）；避免写出非法组合。
  if (activeFlow === '') step = 'IDLE';

  return {
    activeFlow,
    step,
    data: { ...(accumulator?.flowData ?? {}) },
  };
}

/** 未进入流水线的出口（转人工/反问）保留上一轮状态，不无脑清空。 */
export function preserveFlowState(
  state: typeof AgentState.State,
): ResolvedFlowState {
  const old = state.flowState;
  const activeFlow = (old?.activeFlow || '') as FlowType;
  const step = (old?.step || 'IDLE') as FlowStatus;
  return {
    activeFlow,
    step:
      activeFlow && isValidFlowStatus(activeFlow, step)
        ? step
        : activeFlow
          ? getDefaultStatus(activeFlow)
          : 'IDLE',
    data: { ...(old?.data ?? {}) },
  };
}

function getDefaultStatus(type: FlowType): FlowStatus {
  if (type === '') return 'IDLE';
  return getTaskType(type) === 'form' ? 'FILLING' : 'COMPLETED';
}

/** 粗粒度业务族：路由标签 → 可能细化出的多个 FlowType 共享同一族。 */
function flowFamily(type: FlowType): string {
  switch (type) {
    case 'DEPOSIT':
    case 'WITHDRAWAL':
    case 'BALANCE_QUERY':
      return 'wallet';
    case 'COUPON_CLAIM':
    case 'COUPON_QUERY':
      return 'coupon';
    case 'ORDER_QUERY':
      return 'order';
    case 'POLICY':
      return 'rag';
    case 'GENERAL':
      return 'general';
    default:
      return '';
  }
}

/** 仅用于测试/日志的浅校验：状态必须属于该 FlowType。 */
export function isKnownFlow(type: FlowType): boolean {
  return (
    type === '' ||
    Object.prototype.hasOwnProperty.call(FLOW_TYPE_REGISTRY, type)
  );
}
