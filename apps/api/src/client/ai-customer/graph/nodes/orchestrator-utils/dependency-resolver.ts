import { DEPENDENCY_MAP } from '@api/client/ai-customer/graph/config/orchestrator.config';

/**
 * resolveExecutionOrder — 依赖解析排序
 * 确保前置 Agent（如 product）在依赖它的 Agent（如 coupon/wallet）之前执行。
 */
export function resolveExecutionOrder(labels: string[]): string[] {
  for (const [prerequisite, dependents] of Object.entries(DEPENDENCY_MAP)) {
    if (labels.includes(prerequisite)) {
      const matchedDependents = dependents.filter((d) => labels.includes(d));
      if (matchedDependents.length > 0) {
        const others = labels.filter(
          (l) => l !== prerequisite && !matchedDependents.includes(l),
        );
        return [prerequisite, ...matchedDependents, ...others];
      }
    }
  }
  return labels;
}
