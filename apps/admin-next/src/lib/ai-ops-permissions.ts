import { useAuthStore } from '@/store/useAuthStore';

/** AI Ops 前端角色判断；后端 RolesGuard 仍是最终边界。 */
export function useAiOpsRole(): string {
  return useAuthStore((s) => s.userInfo?.role ?? 'viewer');
}

export function canManageQueues(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

export function canManageFlows(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

export function canReadMemory(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

export function canDeleteMemory(role: string): boolean {
  return role === 'SUPER_ADMIN';
}

export function canReadContext(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

export function canAnnotate(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

export function canReadEvalReports(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

export function canTriageFeedback(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

export function canTriageSecurity(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

/** 候选审核台：列表只读 VIEWER 也可（页面按角色禁用动作）。 */
export function canReviewKbCandidates(role: string): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

/** 意图域管理（含 DOMAIN_DESCRIPTION 候选生效）仅 SUPER_ADMIN。 */
export function canManageIntentDomains(role: string): boolean {
  return role === 'SUPER_ADMIN';
}
