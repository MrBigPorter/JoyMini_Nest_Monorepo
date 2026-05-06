/**
 *  操作日志与权限控制统一常量
 * @description 该文件由前后端共享，修改时请注意同步影响
 */

// ==========================================
// 1. 操作类型 (对应 DB: operation_type TINYINT)
// ==========================================
export enum OpType {
  QUERY = 1, // 查询/查看
  CREATE = 2, // 新增
  UPDATE = 3, // 修改/更新
  DELETE = 4, // 删除
  AUDIT = 5, // 审核 (通过/拒绝)
  EXPORT = 6, // 导出数据
  OTHER = 99, // 其他操作
}

// ==========================================
// 2. 业务模块 (对应 DB: module VARCHAR)
// ==========================================
export enum OpModule {
  USER = "user_management", // 用户管理
  TREASURE = "treasure_management", // 产品/夺宝管理
  ORDER = "order_management", // 订单管理
  FINANCE = "finance_management", // 财务管理
  MARKETING = "marketing_management", // 营销活动
  SYSTEM = "system_management", // 系统配置
  CS = "customer_service", // 客服/工单
}

// ==========================================
// 3. 具体动作 (对应 DB: action VARCHAR)
// ==========================================
export const OpAction = {
  // --- 用户模块 ---
  USER: {
    VIEW: "view_user", // 查看用户详情
    UPDATE: "update_user_info", // 修改用户信息
    KYC_AUDIT: "audit_kyc", // 审核KYC
    BAN: "ban_user", // 封禁用户
    UNBAN: "unban_user", // 解封用户
    ADJUST_BALANCE: "adjust_balance", // 调整余额 (特权)
    DELETE: "delete_user", // 删除用户
    CREATE: "create_user", // 创建用户
  },

  // ---  产品模块 ---
  TREASURE: {
    VIEW: "view_treasure", // 查看产品
    CREATE: "create_treasure", // 创建产品
    UPDATE: "update_treasure", // 修改产品
    ON_SHELF: "treasure_on_shelf", // 上架
    OFF_SHELF: "treasure_off_shelf", // 下架
    LOTTERY: "execute_lottery", // 强制开奖
    DELETE: "delete_treasure", // 删除产品
  },

  // --- 订单模块 ---
  ORDER: {
    VIEW: "view_order", // 查看订单
    CANCEL: "cancel_order", // 取消订单
    REFUND_AUDIT: "audit_refund", // 退款审核
    EXPORT: "export_order", // 导出订单
    UPDATE: "update_order", // 修改订单
    DELETE: "delete_order", // 删除订单
  },

  // ---  财务模块 ---
  FINANCE: {
    VIEW: "view_finance", // 查看财务数据
    MANUAL_ADJUST: "manual_adjust", // 人工调账 (高危)
    WITHDRAW_AUDIT: "audit_withdraw", // 提现审核
    RECHARGE_AUDIT: "audit_recharge", // 充值审核/补单
    EXPORT: "export_finance", // 导出报表
    CREATE_PAYMENT_CHANNEL: "create_payment_channel", // 创建支付渠道
    CHANNEL_VIEW: "view_payment_channel", // 查看渠道列表
    CHANNEL_UPDATE: "update_payment_channel", // 修改渠道(开关/限额/费率)
  },

  // ---  营销模块 ---
  MARKETING: {
    VIEW: "view_activity", // 查看活动
    CREATE: "create_activity", // 创建活动
    UPDATE: "update_activity", // 修改活动
    SEND_COUPON: "send_coupon", // 定向发券
    DELETE: "delete_activity", // 删除活动
  },

  // ---  系统模块 ---
  SYSTEM: {
    VIEW: "view_system", // 查看系统设置/角色概览（只读）
    CREATE_ADMIN: "create_admin", // 创建管理员
    UPDATE_ROLE: "update_role", // 修改角色权限
    CONFIG: "update_system_config", // 修改系统配置
    SEND_NOTIF: "send_notification", // 发送系统通知
  },

  // --- 客服模块 ---
  CS: {
    REPLY: "reply_ticket", // 回复工单
    CLOSE: "close_ticket", // 关闭工单
  },
};

// ==========================================
// 4. UI 展示映射 (用于前端下拉框/日志列表)
// ==========================================

/** 模块中文名称 */
export const OpModuleLabel: Record<string, string> = {
  [OpModule.USER]: "用户管理",
  [OpModule.TREASURE]: "产品管理",
  [OpModule.ORDER]: "订单管理",
  [OpModule.FINANCE]: "财务管理",
  [OpModule.MARKETING]: "营销管理",
  [OpModule.SYSTEM]: "系统设置",
  [OpModule.CS]: "客服中心",
};

/** 操作类型中文名称 */
export const OpTypeLabel: Record<number, string> = {
  [OpType.QUERY]: "查询",
  [OpType.CREATE]: "新增",
  [OpType.UPDATE]: "修改",
  [OpType.DELETE]: "删除",
  [OpType.AUDIT]: "审核",
  [OpType.EXPORT]: "导出",
  [OpType.OTHER]: "其他",
};
