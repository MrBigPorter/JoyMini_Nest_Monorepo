// 需要确认的工具不再维护静态清单：
// 由 ToolRegistry 从工具的 capability.kind === 'write' 推导。
// 动作映射与卡片摘要从 ACTION_CATALOG 派生（唯一事实源）。

import {
  getCatalogEntryByAction,
  getCatalogEntryByTool,
} from '../../config/action-catalog';

export const NEGATIVE_KEYWORDS = [
  '烦',
  '投诉',
  '差',
  '慢',
  '垃圾',
  '没用',
  'frustrated',
  'angry',
  'useless',
  'terrible',
  'waste',
  'complaint',
  ' escalate',
];

/** tool name → action 映射（未知工具原样返回，便于日志定位） */
export function mapToolToAction(toolName: string): string {
  return getCatalogEntryByTool(toolName)?.action ?? toolName;
}

/** 构建卡片展示摘要（向后兼容旧客户端的 summary 字段） */
export function buildConfirmSummary(tool: {
  name: string;
  args: Record<string, any>;
}) {
  const entry = getCatalogEntryByTool(tool.name);
  if (!entry) {
    return { action: mapToolToAction(tool.name) };
  }
  return entry.buildSummary(tool.args ?? {});
}

/** 卡片附加元数据：标题 / 展示字段 / 是否需要 OTP */
export function getConfirmActionMeta(action: string) {
  const entry = getCatalogEntryByAction(action);
  if (!entry) return undefined;
  return {
    action: entry.action,
    title: entry.title,
    needsOtp: entry.needsOtp,
  };
}
