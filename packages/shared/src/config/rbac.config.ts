import { OpModule, OpAction, OpModuleLabel } from "../constants/operation-log.constants";
import { Role } from "../types/enums";

/**
 * 核心逻辑：这里决定了 ADMIN 能不能 VIEW
 */
export const RolePermissions = {
  // ------------------------------------------
  //  ADMIN (普通管理员)
  // ------------------------------------------
  [Role.ADMIN]: [
    //  1. 用户模块权限
    `${OpModule.USER}:${OpAction.USER.VIEW}`, // "user_management:view_user"
    `${OpModule.USER}:${OpAction.USER.UPDATE}`, // "user_management:update_user_info"
    `${OpModule.USER}:${OpAction.USER.BAN}`, // "user_management:ban_user"

    //  2. 订单模块权限
    `${OpModule.ORDER}:${OpAction.ORDER.VIEW}`,
    `${OpModule.ORDER}:${OpAction.ORDER.EXPORT}`,

    //  3. 优惠券/营销权限
    `${OpModule.MARKETING}:${OpAction.MARKETING.VIEW}`, // ✅ 这样 ADMIN 就能调 findAll 了
    `${OpModule.MARKETING}:${OpAction.MARKETING.CREATE}`, // ✅ 这样 ADMIN 就能 create 了
    `${OpModule.MARKETING}:${OpAction.MARKETING.UPDATE}`,

    //  4. 财务查看权限（只读，不含 manual_adjust 高危操作）
    `${OpModule.FINANCE}:${OpAction.FINANCE.VIEW}`, // "finance_management:view_finance"
    `${OpModule.FINANCE}:${OpAction.FINANCE.CHANNEL_VIEW}`, // 查看支付渠道

    //  5. 产品（夺宝）管理权限
    `${OpModule.TREASURE}:${OpAction.TREASURE.VIEW}`, // "treasure_management:view_treasure"
    `${OpModule.TREASURE}:${OpAction.TREASURE.CREATE}`, // 创建产品
    `${OpModule.TREASURE}:${OpAction.TREASURE.UPDATE}`, // 修改产品
    `${OpModule.TREASURE}:${OpAction.TREASURE.ON_SHELF}`, // 上架
    `${OpModule.TREASURE}:${OpAction.TREASURE.OFF_SHELF}`, // 下架
    `${OpModule.TREASURE}:${OpAction.TREASURE.LOTTERY}`, // 强制开奖
    `${OpModule.TREASURE}:${OpAction.TREASURE.DELETE}`, // 删除产品
  ],

  // ------------------------------------------
  // EDITOR (运营/编辑)
  // ------------------------------------------
  [Role.EDITOR]: [
    // 运营只能看用户，不能封号
    `${OpModule.USER}:${OpAction.USER.VIEW}`,

    // 运营管理所有营销活动
    `${OpModule.MARKETING}:${OpAction.MARKETING.VIEW}`,
    `${OpModule.MARKETING}:${OpAction.MARKETING.CREATE}`,
    `${OpModule.MARKETING}:${OpAction.MARKETING.UPDATE}`,
    // 注意：没给他 DELETE 权限，所以 Controller 上那个 Delete 接口他调不通
  ],

  // ------------------------------------------
  //  VIEWER (观察者)
  // ------------------------------------------
  [Role.VIEWER]: [
    // 只能看，啥都不能改
    `${OpModule.USER}:${OpAction.USER.VIEW}`,
    `${OpModule.ORDER}:${OpAction.ORDER.VIEW}`,
    `${OpModule.MARKETING}:${OpAction.MARKETING.VIEW}`,
  ],

  // ------------------------------------------
  //  FINANCE (财务专员)
  // ------------------------------------------
  [Role.FINANCE]: [
    // 查看财务数据
    `${OpModule.FINANCE}:${OpAction.FINANCE.VIEW}`,
    // 提现审核
    `${OpModule.FINANCE}:${OpAction.FINANCE.WITHDRAW_AUDIT}`,
    // 充值审核/补单
    `${OpModule.FINANCE}:${OpAction.FINANCE.RECHARGE_AUDIT}`,
    // 导出报表
    `${OpModule.FINANCE}:${OpAction.FINANCE.EXPORT}`,
    // 查看支付渠道（只读）
    `${OpModule.FINANCE}:${OpAction.FINANCE.CHANNEL_VIEW}`,
    // 查看订单（关联财务）
    `${OpModule.ORDER}:${OpAction.ORDER.VIEW}`,
    `${OpModule.ORDER}:${OpAction.ORDER.EXPORT}`,
  ],
} satisfies Partial<Record<Role | string, readonly string[]>>;

/**
 * 角色展示名称（中英文）
 * 用于前端 RBAC 权限管理界面
 */
export const RoleDescriptions: Record<Role, { en: string; zh: string; description: string }> = {
  [Role.SUPER_ADMIN]: {
    en: "Super Admin",
    zh: "超级管理员",
    description: "Full access to all modules. Cannot be restricted.",
  },
  [Role.ADMIN]: {
    en: "Admin",
    zh: "管理员",
    description: "Manages users, orders, and marketing activities.",
  },
  [Role.EDITOR]: {
    en: "Editor",
    zh: "编辑/运营",
    description: "Manages marketing content and views user data.",
  },
  [Role.VIEWER]: {
    en: "Viewer",
    zh: "观察者",
    description: "Read-only access to users, orders, and marketing.",
  },
  [Role.FINANCE]: {
    en: "Finance",
    zh: "财务专员",
    description: "Handles finance audits, withdrawals, and reports.",
  },
};

/**
 * Re-export OpModuleLabel for frontend convenience
 */
export { OpModuleLabel };

