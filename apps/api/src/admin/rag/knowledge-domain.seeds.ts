/**
 * 文档域种子（bootstrap only）
 *
 * 单独放一个不依赖 Nest 的文件：seed 脚本、parity 测试、服务层
 * 读同一份定义，但不会因为导入常量而拉起 Prisma/Nest 模块。
 */
export interface KnowledgeDomainSeed {
  key: string;
  label: string;
  description: string;
  candidateTargetIntent: string;
  sortOrder: number;
}

export interface KnowledgeDomainSnapshot {
  key: string;
  label: string;
  description: string;
  candidateTargetIntent: string;
  enabled: boolean;
  sortOrder: number;
}

/**
 * 默认文档域。`candidateTargetIntent` 一律先指向 rag：
 * 大多数文档回答的是「政策/规则/FAQ」，属于知识型问题；
 * 真正需要业务动作的文档可以在文档级 `candidateTargetDomain` 覆盖。
 */
export const KNOWLEDGE_DOMAIN_SEEDS: KnowledgeDomainSeed[] = [
  {
    key: 'order',
    label: '订单',
    description: '订单状态、物流、取消、退货退款等订单流程与规则',
    candidateTargetIntent: 'rag',
    sortOrder: 0,
  },
  {
    key: 'wallet',
    label: '钱包',
    description: '余额、充值、提现、交易记录、支付方式',
    candidateTargetIntent: 'rag',
    sortOrder: 1,
  },
  {
    key: 'coupon',
    label: '优惠券',
    description: '优惠券领取、使用、过期与折扣规则',
    candidateTargetIntent: 'rag',
    sortOrder: 2,
  },
  {
    key: 'product',
    label: '商品',
    description: '商品详情、规格、库存、尺码与推荐',
    candidateTargetIntent: 'rag',
    sortOrder: 3,
  },
  {
    key: 'user',
    label: '用户',
    description: '账号资料、地址簿、手机号/邮箱修改',
    candidateTargetIntent: 'rag',
    sortOrder: 4,
  },
  {
    key: 'kyc',
    label: '实名认证',
    description: '实名认证要求、资料上传、审核状态与驳回原因',
    candidateTargetIntent: 'rag',
    sortOrder: 5,
  },
  {
    key: 'lucky-draw',
    label: '抽奖',
    description: '抽奖玩法、开奖时间、奖品与领奖',
    candidateTargetIntent: 'rag',
    sortOrder: 6,
  },
  {
    key: 'common',
    label: '通用',
    description: '跨业务区的通用政策、FAQ 与平台规则',
    candidateTargetIntent: 'rag',
    sortOrder: 7,
  },
];
