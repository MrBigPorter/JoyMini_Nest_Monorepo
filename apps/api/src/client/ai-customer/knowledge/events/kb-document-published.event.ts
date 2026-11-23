/**
 * 知识库文档「已发布」事件契约（121-M1）
 *
 * 发布点 = `KbVersionService.switchTo` 的 CAS 成功 + epoch bump 之后。
 * 这是「文档真正可被检索」的时刻，而不是上传或切片完成的时刻。
 *
 * 事件是进程内、非持久的（EventEmitter2）。因此生成链路必须同时有
 * 每 10 分钟的补偿扫描；事件丢了，扫描会补上。
 */

export const KB_DOCUMENT_PUBLISHED = 'kb.document.published.v1';

export type KbPublishTrigger =
  | 'upload'
  | 'reindex'
  | 'manual'
  /** 回滚也会切换版本，但旧内容不该重新生成候选，监听器会跳过 */
  | 'rollback';

export interface KbDocumentPublishedEvent {
  documentId: string;
  /** 本次发布出去的版本号 */
  documentVersion: number;
  /** 切换前的对外版本；already-active 时与 documentVersion 相同 */
  previousVersion: number;
  /** 文档域（order / wallet / ... / common） */
  domain: string;
  docId: string;
  title: string;
  locale: string;
  contentType: string;
  keywords: string[];
  contentHash: string | null;
  /** 文档级候选投放意图覆盖；为空时按 knowledge_domains 映射 */
  candidateTargetDomain: string | null;
  trigger: KbPublishTrigger;
  /** false 表示发布动作发生了但未完成切换（目前只在异常路径出现） */
  switched: boolean;
  publishedAt: string;
  tenantId: string | null;
}
