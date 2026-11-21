/**
 * 交接生命周期的注入令牌。
 *
 * EventsGateway 只需要「重开会话」这一项能力。直接注入 HandoffLifecycleService
 * 会让 events.gateway ↔ handoff-lifecycle 形成文件级循环依赖，并把 uuid 等
 * 纯 ESM 依赖带进事件层的单测。这里用一个窄接口 + symbol 令牌解耦：
 *   - EventsGateway 只 import 本文件；
 *   - HandoffModule 用 useExisting 把真实服务绑定到令牌上。
 */
export const HANDOFF_LIFECYCLE = Symbol('HANDOFF_LIFECYCLE');

export interface HandoffReopenPort {
  /** 关闭后的 SUPPORT 会话收到用户消息时同会话重开；CAS 保证只成功一次。 */
  reopenForUser(conversationId: string): Promise<boolean>;
}
