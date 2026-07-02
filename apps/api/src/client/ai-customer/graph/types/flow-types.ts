/**
 * Flow Type System — 强类型 Flow 状态定义
 *
 * 设计原则：
 * 1. FlowType 和 FlowStatus 是 union type（编译期校验），不是运行时 string
 * 2. FLOW_TYPE_REGISTRY 是静态配置表，定义每个 FlowType 的允许状态集合
 * 3. isValidFlowStatus() 在 reducer 中做运行时校验，防止非法状态转换
 * 4. PAUSED 不是 FlowStatus 值，而是通过独立 pausedFlow 字段实现
 */

// ============================================================
// FlowType — 业务类型（9 种）
// ============================================================
/** 业务类型：''=未设置, DEPOSIT=充值, WITHDRAWAL=取款, COUPON_CLAIM=领券, BALANCE_QUERY=查余额, ORDER_QUERY=查订单, COUPON_QUERY=查优惠券, POLICY=政策, GENERAL=闲聊 */
export type FlowType =
  | ''
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'COUPON_CLAIM'
  | 'BALANCE_QUERY'
  | 'ORDER_QUERY'
  | 'COUPON_QUERY'
  | 'POLICY'
  | 'GENERAL';

// ============================================================
// TaskType — 任务类型（用于意图路由判断）
// ============================================================
/** 任务类型：'form'=表单流程（slot filling），'query'=单次查询 */
export type TaskType = 'form' | 'query';

// ============================================================
// FlowStatus — 状态值（7 种）
// ============================================================
/**
 * 业务流程状态：
 * - IDLE: 初始状态，未开始
 * - FILLING: 填表阶段（slot filling，收集必填信息）
 * - CONFIRMING: 确认阶段（展示预览，让用户确认）
 * - QUERYING: 查询中（单次查询，如查余额）
 * - RAG: 知识检索中（政策/活动查询）
 * - COMPLETED: 已完成
 * - FAILED: 失败/拒绝
 */
export type FlowStatus =
  | 'IDLE'
  | 'FILLING'
  | 'CONFIRMING'
  | 'QUERYING'
  | 'RAG'
  | 'COMPLETED'
  | 'FAILED';

// ============================================================
// FlowTypeConfig — 每个 FlowType 的配置
// ============================================================
export interface FlowTypeConfig {
  /** 业务名称（中文，用于日志和 Prompt） */
  label: string;
  /** 任务类型 */
  taskType: TaskType;
  /** 允许的 FlowStatus 集合 */
  allowedStatuses: FlowStatus[];
}

// ============================================================
// FLOW_TYPE_REGISTRY — 静态配置表
// ============================================================
/** FlowType 注册表：定义每个业务类型的允许状态和行为 */
export const FLOW_TYPE_REGISTRY: Record<
  Exclude<FlowType, ''>,
  FlowTypeConfig
> = {
  DEPOSIT: {
    label: '充值',
    taskType: 'form',
    allowedStatuses: ['IDLE', 'FILLING', 'CONFIRMING', 'COMPLETED', 'FAILED'],
  },
  WITHDRAWAL: {
    label: '取款',
    taskType: 'form',
    allowedStatuses: ['IDLE', 'FILLING', 'CONFIRMING', 'COMPLETED', 'FAILED'],
  },
  COUPON_CLAIM: {
    label: '领券',
    taskType: 'form',
    allowedStatuses: ['IDLE', 'FILLING', 'CONFIRMING', 'COMPLETED', 'FAILED'],
  },
  BALANCE_QUERY: {
    label: '查余额',
    taskType: 'query',
    allowedStatuses: ['IDLE', 'QUERYING', 'COMPLETED', 'FAILED'],
  },
  ORDER_QUERY: {
    label: '查订单',
    taskType: 'query',
    allowedStatuses: ['IDLE', 'QUERYING', 'COMPLETED', 'FAILED'],
  },
  COUPON_QUERY: {
    label: '查优惠券',
    taskType: 'query',
    allowedStatuses: ['IDLE', 'QUERYING', 'COMPLETED', 'FAILED'],
  },
  POLICY: {
    label: '政策查询',
    taskType: 'query',
    allowedStatuses: ['IDLE', 'RAG', 'COMPLETED', 'FAILED'],
  },
  GENERAL: {
    label: '闲聊',
    taskType: 'query',
    allowedStatuses: ['IDLE', 'QUERYING', 'COMPLETED', 'FAILED'],
  },
};

// ============================================================
// PausedFlow — 暂停状态（Type B 中断）
// ============================================================
/**
 * Type B (Pause & Resume) 暂停时保存的上下文。
 * PAUSED 不是 FlowStatus 值，而是通过此独立字段实现，
 * 避免对 FlowStatus 枚举造成语义污染。
 */
export interface PausedFlow {
  /** 暂停时的业务类型 */
  flowType: FlowType;
  /** 暂停时的流程状态 */
  flowStatus: FlowStatus;
  /** 暂停时的表单数据 */
  flowData: Record<string, any>;
  /** 暂停时的当前 Agent */
  currentAgent: string;
  /** 暂停时的意图 */
  intent: string;
  /** 暂停时的路由缓存 */
  routeCache: string;
  /** 暂停时间戳（用于超时判断） */
  pausedAt: number;
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * 根据 FlowType 获取 TaskType。
 * @param type FlowType 值
 * @returns 'form' | 'query' | null（'' 返回 null）
 */
export function getTaskType(type: FlowType): TaskType | null {
  if (type === '') return null;
  return FLOW_TYPE_REGISTRY[type].taskType;
}

/**
 * 验证给定的 FlowStatus 对于指定的 FlowType 是否合法。
 * 在 flowStatus reducer 中使用，防止非法状态转换。
 * @param type FlowType 值
 * @param status 要检查的 FlowStatus
 * @returns true 如果该状态对当前 FlowType 合法
 */
export function isValidFlowStatus(
  type: FlowType,
  status: FlowStatus,
): boolean {
  if (type === '') {
    // '' 类型只允许 IDLE
    return status === 'IDLE';
  }
  return FLOW_TYPE_REGISTRY[type].allowedStatuses.includes(status);
}

/**
 * 获取指定 FlowType 的初始状态。
 * @param type FlowType 值
 * @returns 初始 FlowStatus（'' → 'IDLE'）
 */
export function getInitialStatus(type: FlowType): FlowStatus {
  return 'IDLE';
}

/**
 * Intent → FlowType 映射表。
 *
 * Intent Router 的 LLM 分类输出（'wallet'/'coupon'/'order' 等）是路由层概念，
 * FlowType（'BALANCE_QUERY'/'COUPON_QUERY'/'ORDER_QUERY' 等）是业务层概念。
 *
 * 部分 intent 可映射到多个 flowType（如 'wallet' → BALANCE_QUERY | DEPOSIT | WITHDRAWAL），
 * 此处返回最通用的 FlowType，后续由 Agent 通过 updateFlowStatus 工具细化。
 *
 * @param intent Intent Router 输出的 intent 字符串
 * @returns 对应的 FlowType，无映射时返回 ''
 */
export function intentToFlowType(intent: string): FlowType {
  const map: Record<string, FlowType> = {
    order: 'ORDER_QUERY',
    wallet: 'BALANCE_QUERY',
    coupon: 'COUPON_QUERY',
    rag: 'POLICY',
    general: 'GENERAL',
  };
  return map[intent] || ('' as FlowType);
}
