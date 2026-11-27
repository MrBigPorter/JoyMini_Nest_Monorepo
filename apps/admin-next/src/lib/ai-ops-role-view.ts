/**
 * 质量台默认视图与角色对应。
 *
 * 四类使用者的第一问题是不同的：运营要处理队列，质量负责人要看这次能不能发，
 * 研发要定位坏在哪一步，管理者要看趋势与成本。默认落点只决定「先看到什么」，
 * 不改变任何数字口径——同一 run 在任何 tab 下都读同一份后端数据。
 *
 * 不新增角色：沿用现有 RBAC（EDITOR / ADMIN / SUPER_ADMIN / VIEWER）。
 */
export type QualityTab = 'feedback' | 'eval' | 'rag';

const ROLE_DEFAULT_TAB: Record<string, QualityTab> = {
  // 运营/编辑：直接进分诊队列，认领与提交。
  EDITOR: 'feedback',
  ADMIN: 'feedback',
  // 研发（只读观察者）：从队列进入，每条反馈自带链路证据；检索调试再切知识质量。
  VIEWER: 'feedback',
  // 质量负责人与管理者：先看运行、基线与发布证据（管理者在同一页看趋势）。
  SUPER_ADMIN: 'eval',
};

/** 未知或未加载的角色退回最保守的队列视图，不猜权限。 */
export function defaultTabForRole(role: string): QualityTab {
  return ROLE_DEFAULT_TAB[role] ?? 'feedback';
}
