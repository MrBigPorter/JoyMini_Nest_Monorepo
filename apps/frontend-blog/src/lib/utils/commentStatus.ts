/**
 * 评论状态管理工具
 * 用于跟踪临时评论的AI审核状态
 */

export type CommentStatus = 'pending' | 'approved' | 'rejected' | 'unknown';

export interface PendingCommentInfo {
  /** 临时评论ID (temp-xxx) */
  tempId: string;
  /** 真实评论ID (服务器返回) */
  realId: string;
  /** 文章ID */
  articleId: string;
  /** 提交时间 */
  submittedAt: Date;
  /** 当前状态 */
  status: CommentStatus;
  /** 轮询尝试次数 */
  pollAttempts: number;
  /** 最大轮询次数 */
  maxPollAttempts: number;
  /** 轮询间隔(毫秒) */
  pollInterval: number;
  /** 轮询定时器ID */
  pollTimer?: NodeJS.Timeout;
}

/**
 * 评论状态管理器
 * 单例模式，全局管理临时评论的状态跟踪
 */
class CommentStatusManager {
  private static instance: CommentStatusManager;
  private pendingComments: Map<string, PendingCommentInfo> = new Map();
  private statusListeners: Map<string, Array<(status: CommentStatus) => void>> =
    new Map();

  private constructor() {
    // 私有构造函数，确保单例
  }

  static getInstance(): CommentStatusManager {
    if (!CommentStatusManager.instance) {
      CommentStatusManager.instance = new CommentStatusManager();
    }
    return CommentStatusManager.instance;
  }

  /**
   * 注册临时评论
   */
  registerPendingComment(
    tempId: string,
    realId: string,
    articleId: string,
    options?: {
      maxPollAttempts?: number;
      pollInterval?: number;
    },
  ): void {
    const pendingComment: PendingCommentInfo = {
      tempId,
      realId,
      articleId,
      submittedAt: new Date(),
      status: 'pending',
      pollAttempts: 0,
      maxPollAttempts: options?.maxPollAttempts || 10, // 默认10次，每次30秒 = 5分钟
      pollInterval: options?.pollInterval || 30000, // 默认30秒
    };

    this.pendingComments.set(tempId, pendingComment);
  }

  /**
   * 更新评论状态
   */
  updateCommentStatus(tempId: string, status: CommentStatus): void {
    const comment = this.pendingComments.get(tempId);
    if (!comment) {
      console.warn(`[评论状态] 未找到临时评论: ${tempId}`);
      return;
    }

    const oldStatus = comment.status;
    comment.status = status;

    // 如果状态变为最终状态(approved/rejected)，清理轮询定时器
    if (status === 'approved' || status === 'rejected') {
      this.clearPollingTimer(tempId);

      // 24小时后自动清理
      setTimeout(
        () => {
          this.removePendingComment(tempId);
        },
        24 * 60 * 60 * 1000,
      );
    }

    // 通知监听器
    this.notifyStatusChange(tempId, status);
  }

  /**
   * 获取评论状态
   */
  getCommentStatus(tempId: string): CommentStatus | null {
    const comment = this.pendingComments.get(tempId);
    return comment?.status || null;
  }

  /**
   * 通过真实评论 ID 更新状态（供 SSE 事件使用，无需知道 tempId）
   */
  updateByRealId(realId: string, status: 'approved' | 'rejected'): void {
    for (const [tempId, info] of this.pendingComments.entries()) {
      if (info.realId === realId) {
        this.updateCommentStatus(tempId, status);
        return;
      }
    }

    // 未找到（可能已过期清理），静默忽略
    console.debug(
      `[评论状态] updateByRealId: 未找到 realId=${realId} 对应的临时评论`,
    );
  }

  /**
   * 获取评论信息
   */
  getCommentInfo(tempId: string): PendingCommentInfo | null {
    return this.pendingComments.get(tempId) || null;
  }

  /**
   * 移除临时评论
   */
  removePendingComment(tempId: string): void {
    this.clearPollingTimer(tempId);
    this.pendingComments.delete(tempId);
    this.statusListeners.delete(tempId);
  }

  /**
   * 清理轮询定时器
   */
  private clearPollingTimer(tempId: string): void {
    const comment = this.pendingComments.get(tempId);
    if (comment?.pollTimer) {
      clearInterval(comment.pollTimer);
      comment.pollTimer = undefined;
    }
  }

  /**
   * 开始状态轮询
   */
  startStatusPolling(
    tempId: string,
    checkStatusCallback: () => Promise<CommentStatus>,
  ): void {
    const comment = this.pendingComments.get(tempId);
    if (!comment) {
      console.warn(`[评论状态] 无法开始轮询，未找到评论: ${tempId}`);
      return;
    }

    // 清理现有定时器
    this.clearPollingTimer(tempId);

    comment.pollTimer = setInterval(async () => {
      comment.pollAttempts++;

      try {
        const status = await checkStatusCallback();

        if (status === 'approved' || status === 'rejected') {
          this.updateCommentStatus(tempId, status);
        } else if (comment.pollAttempts >= comment.maxPollAttempts) {
          this.clearPollingTimer(tempId);
          this.updateCommentStatus(tempId, 'unknown');
        }
      } catch (error) {
        console.error(`[评论状态] 轮询检查失败: ${tempId}`, error);

        if (comment.pollAttempts >= comment.maxPollAttempts) {
          this.clearPollingTimer(tempId);
          this.updateCommentStatus(tempId, 'unknown');
        }
      }
    }, comment.pollInterval);
  }

  /**
   * 注册状态监听器
   */
  subscribe(
    tempId: string,
    callback: (status: CommentStatus) => void,
  ): () => void {
    if (!this.statusListeners.has(tempId)) {
      this.statusListeners.set(tempId, []);
    }

    const listeners = this.statusListeners.get(tempId)!;
    listeners.push(callback);

    // 返回取消订阅函数
    return () => {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }

  /**
   * 通知状态变化
   */
  private notifyStatusChange(tempId: string, status: CommentStatus): void {
    const listeners = this.statusListeners.get(tempId);
    if (listeners) {
      listeners.forEach((callback) => {
        try {
          callback(status);
        } catch (error) {
          console.error(`[评论状态] 监听器回调错误: ${tempId}`, error);
        }
      });
    }
  }

  /**
   * 获取所有待处理评论
   */
  getAllPendingComments(): PendingCommentInfo[] {
    return Array.from(this.pendingComments.values());
  }

  /**
   * 清理过期的评论（超过24小时）
   */
  cleanupExpiredComments(): void {
    const now = new Date();
    const expiredTime = 24 * 60 * 60 * 1000; // 24小时

    for (const [tempId, comment] of this.pendingComments.entries()) {
      const age = now.getTime() - comment.submittedAt.getTime();
      if (age > expiredTime) {
        this.removePendingComment(tempId);
      }
    }
  }

  /**
   * 重置管理器（主要用于测试）
   */
  reset(): void {
    for (const [tempId] of this.pendingComments.entries()) {
      this.clearPollingTimer(tempId);
    }
    this.pendingComments.clear();
    this.statusListeners.clear();
  }
}

// 导出单例实例
export const commentStatusManager = CommentStatusManager.getInstance();

/**
 * 检查评论状态的工具函数
 */
export async function checkCommentStatus(
  articleId: string,
  commentId: string,
): Promise<CommentStatus> {
  try {
    // 动态导入以避免循环依赖
    const { frontendBlogApi } = await import('@/lib/api/frontendBlogApi');

    // 使用新的评论状态查询API
    const response = await frontendBlogApi.getCommentStatus(commentId);

    // 根据后端返回的status字段转换为前端状态
    const status = response.status.toLowerCase();

    switch (status) {
      case 'approved':
        return 'approved';
      case 'pending':
        return 'pending';
      case 'rejected':
        return 'rejected';
      default:
        console.warn(`[评论状态] 未知状态: ${status}`);
        return 'unknown';
    }
  } catch (error: any) {
    // 如果评论不存在（404），可能是被删除或从未创建
    if (error.response?.status === 404) {
      console.warn(`[评论状态] 评论 ${commentId} 不存在，可能已被删除`);
      return 'rejected'; // 假设被拒绝
    }

    console.error('[评论状态] 检查评论状态失败:', error);
    return 'unknown';
  }
}

/**
 * 创建状态检查回调函数
 */
export function createStatusCheckCallback(
  articleId: string,
  commentId: string,
): () => Promise<CommentStatus> {
  return () => checkCommentStatus(articleId, commentId);
}

/**
 * 显示拒绝通知
 */
export function showRejectionNotification(reason?: string): void {
  // 尝试使用现有的toast系统
  if (typeof window !== 'undefined') {
    // 检查是否有toast系统
    const toast = (window as any).toast;
    if (toast && typeof toast.error === 'function') {
      toast.error(`评论未通过审核${reason ? `: ${reason}` : ''}`, {
        duration: 5000,
        position: 'bottom-right',
      });
      return;
    }
  }

  // 后备方案：使用console.log或alert
  console.warn(`评论未通过审核${reason ? `: ${reason}` : ''}`);

  // 注意：在生产环境中，alert可能太干扰，这里只是作为后备
  // 实际项目中应该使用更优雅的通知系统
  if (process.env.NODE_ENV === 'development') {
    // alert(`评论未通过审核${reason ? `: ${reason}` : ''}`);
  }
}

/**
 * 工具函数：判断是否为临时评论ID
 */
export function isTempCommentId(commentId: string): boolean {
  return commentId.startsWith('temp-');
}

/**
 * 工具函数：从临时评论ID提取时间戳
 */
export function getTempCommentTimestamp(tempId: string): number | null {
  const match = tempId.match(/^temp-(\d+)$/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}
