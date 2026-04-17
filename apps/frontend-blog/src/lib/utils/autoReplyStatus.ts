/**
 * 自动回复状态管理工具
 * 用于跟踪评论的AI自动回复状态
 */

export type AutoReplyStatus = 'pending' | 'received' | 'timeout' | 'error';

export interface AutoReplyInfo {
  /** 评论ID */
  commentId: string;
  /** 文章ID */
  articleId: string;
  /** 提交时间 */
  submittedAt: Date;
  /** 当前状态 */
  status: AutoReplyStatus;
  /** 轮询尝试次数 */
  pollAttempts: number;
  /** 最大轮询次数 */
  maxPollAttempts: number;
  /** 轮询间隔(毫秒) */
  pollInterval: number;
  /** 轮询定时器ID */
  pollTimer?: NodeJS.Timeout;
  /** 自动回复内容（收到后填充） */
  replyContent?: string;
  /** 自动回复作者 */
  replyAuthor?: string;
}

/**
 * 自动回复状态管理器
 * 单例模式，全局管理评论的自动回复状态跟踪
 */
class AutoReplyStatusManager {
  private static instance: AutoReplyStatusManager;
  private autoReplyTrackers: Map<string, AutoReplyInfo> = new Map();
  private statusListeners: Map<
    string,
    Array<(status: AutoReplyStatus, reply?: any) => void>
  > = new Map();

  private constructor() {
    // 私有构造函数，确保单例
  }

  static getInstance(): AutoReplyStatusManager {
    if (!AutoReplyStatusManager.instance) {
      AutoReplyStatusManager.instance = new AutoReplyStatusManager();
    }
    return AutoReplyStatusManager.instance;
  }

  /**
   * 注册评论以跟踪自动回复
   */
  registerAutoReplyTracker(
    commentId: string,
    articleId: string,
    options?: {
      maxPollAttempts?: number;
      pollInterval?: number;
      startDelay?: number; // 延迟开始轮询（等待自动回复生成）
    },
  ): void {
    const autoReplyInfo: AutoReplyInfo = {
      commentId,
      articleId,
      submittedAt: new Date(),
      status: 'pending',
      pollAttempts: 0,
      maxPollAttempts: options?.maxPollAttempts || 5, // 默认5次，每次15秒 = 75秒
      pollInterval: options?.pollInterval || 15000, // 默认15秒
    };

    this.autoReplyTrackers.set(commentId, autoReplyInfo);
    console.log(
      `[自动回复] 注册自动回复跟踪: 评论 ${commentId}, 文章: ${articleId}`,
    );

    // 延迟开始轮询（等待30秒后自动回复生成）
    const startDelay = options?.startDelay || 30000; // 默认30秒
    setTimeout(() => {
      this.startAutoReplyPolling(commentId);
    }, startDelay);
  }

  /**
   * 更新自动回复状态
   */
  updateAutoReplyStatus(
    commentId: string,
    status: AutoReplyStatus,
    reply?: { content: string; author: string },
  ): void {
    const tracker = this.autoReplyTrackers.get(commentId);
    if (!tracker) {
      console.warn(`[自动回复] 未找到自动回复跟踪: ${commentId}`);
      return;
    }

    const oldStatus = tracker.status;
    tracker.status = status;

    if (reply) {
      tracker.replyContent = reply.content;
      tracker.replyAuthor = reply.author;
    }

    // 如果状态变为最终状态(received/timeout/error)，清理轮询定时器
    if (status === 'received' || status === 'timeout' || status === 'error') {
      this.clearPollingTimer(commentId);

      // 1小时后自动清理
      setTimeout(
        () => {
          this.removeAutoReplyTracker(commentId);
        },
        60 * 60 * 1000,
      );
    }

    console.log(
      `[自动回复] 更新自动回复状态: ${commentId} ${oldStatus} -> ${status}`,
    );

    // 通知监听器
    this.notifyStatusChange(commentId, status, reply);
  }

  /**
   * 获取自动回复状态
   */
  getAutoReplyStatus(commentId: string): AutoReplyStatus | null {
    const tracker = this.autoReplyTrackers.get(commentId);
    return tracker?.status || null;
  }

  /**
   * 获取自动回复信息
   */
  getAutoReplyInfo(commentId: string): AutoReplyInfo | null {
    return this.autoReplyTrackers.get(commentId) || null;
  }

  /**
   * 移除自动回复跟踪
   */
  removeAutoReplyTracker(commentId: string): void {
    this.clearPollingTimer(commentId);
    this.autoReplyTrackers.delete(commentId);
    this.statusListeners.delete(commentId);
    console.log(`[自动回复] 移除自动回复跟踪: ${commentId}`);
  }

  /**
   * 清理轮询定时器
   */
  private clearPollingTimer(commentId: string): void {
    const tracker = this.autoReplyTrackers.get(commentId);
    if (tracker?.pollTimer) {
      clearInterval(tracker.pollTimer);
      tracker.pollTimer = undefined;
    }
  }

  /**
   * 开始自动回复轮询
   */
  private startAutoReplyPolling(commentId: string): void {
    const tracker = this.autoReplyTrackers.get(commentId);
    if (!tracker) {
      console.warn(`[自动回复] 无法开始轮询，未找到跟踪: ${commentId}`);
      return;
    }

    // 清理现有定时器
    this.clearPollingTimer(commentId);

    console.log(
      `[自动回复] 开始自动回复轮询: ${commentId}, 间隔: ${tracker.pollInterval}ms`,
    );

    tracker.pollTimer = setInterval(async () => {
      tracker.pollAttempts++;

      try {
        // 动态导入以避免循环依赖
        const { frontendBlogApi } = await import('@/lib/api/frontendBlogApi');

        // 检查评论是否有回复
        const response = await frontendBlogApi.getCommentReplies(commentId);

        if (response.replies && response.replies.length > 0) {
          // 找到自动回复（作者为"Porter"或包含"system"）
          const autoReply = response.replies.find(
            (reply: any) =>
              reply.author === 'Porter' ||
              reply.author === 'System' ||
              reply.isAiGenerated === true,
          );

          if (autoReply) {
            // 找到自动回复，更新状态
            this.updateAutoReplyStatus(commentId, 'received', {
              content: autoReply.content,
              author: autoReply.author,
            });
          } else if (tracker.pollAttempts >= tracker.maxPollAttempts) {
            // 达到最大尝试次数，停止轮询
            console.log(
              `[自动回复] 轮询超时: ${commentId}, 尝试次数: ${tracker.pollAttempts}`,
            );
            this.clearPollingTimer(commentId);
            this.updateAutoReplyStatus(commentId, 'timeout');
          }
        } else if (tracker.pollAttempts >= tracker.maxPollAttempts) {
          // 达到最大尝试次数，停止轮询
          console.log(
            `[自动回复] 轮询超时: ${commentId}, 尝试次数: ${tracker.pollAttempts}`,
          );
          this.clearPollingTimer(commentId);
          this.updateAutoReplyStatus(commentId, 'timeout');
        }
      } catch (error) {
        console.error(`[自动回复] 轮询检查失败: ${commentId}`, error);

        if (tracker.pollAttempts >= tracker.maxPollAttempts) {
          this.clearPollingTimer(commentId);
          this.updateAutoReplyStatus(commentId, 'error');
        }
      }
    }, tracker.pollInterval);
  }

  /**
   * 注册状态监听器
   */
  subscribe(
    commentId: string,
    callback: (status: AutoReplyStatus, reply?: any) => void,
  ): () => void {
    if (!this.statusListeners.has(commentId)) {
      this.statusListeners.set(commentId, []);
    }

    const listeners = this.statusListeners.get(commentId)!;
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
  private notifyStatusChange(
    commentId: string,
    status: AutoReplyStatus,
    reply?: any,
  ): void {
    const listeners = this.statusListeners.get(commentId);
    if (listeners) {
      listeners.forEach((callback) => {
        try {
          callback(status, reply);
        } catch (error) {
          console.error(`[自动回复] 监听器回调错误: ${commentId}`, error);
        }
      });
    }
  }

  /**
   * 获取所有自动回复跟踪
   */
  getAllAutoReplyTrackers(): AutoReplyInfo[] {
    return Array.from(this.autoReplyTrackers.values());
  }

  /**
   * 清理过期的跟踪（超过1小时）
   */
  cleanupExpiredTrackers(): void {
    const now = new Date();
    const expiredTime = 60 * 60 * 1000; // 1小时

    for (const [commentId, tracker] of this.autoReplyTrackers.entries()) {
      const age = now.getTime() - tracker.submittedAt.getTime();
      if (age > expiredTime) {
        console.log(`[自动回复] 清理过期跟踪: ${commentId}, 年龄: ${age}ms`);
        this.removeAutoReplyTracker(commentId);
      }
    }
  }

  /**
   * 重置管理器（主要用于测试）
   */
  reset(): void {
    for (const [commentId] of this.autoReplyTrackers.entries()) {
      this.clearPollingTimer(commentId);
    }
    this.autoReplyTrackers.clear();
    this.statusListeners.clear();
  }
}

// 导出单例实例
export const autoReplyStatusManager = AutoReplyStatusManager.getInstance();

/**
 * 检查评论回复的工具函数
 */
export async function checkCommentReplies(commentId: string): Promise<{
  hasReply: boolean;
  reply?: { content: string; author: string };
}> {
  try {
    // 动态导入以避免循环依赖
    const { frontendBlogApi } = await import('@/lib/api/frontendBlogApi');

    // 使用评论回复查询API
    const response = await frontendBlogApi.getCommentReplies(commentId);

    if (response.replies && response.replies.length > 0) {
      // 查找自动回复
      const autoReply = response.replies.find(
        (reply: any) =>
          reply.author === 'Porter' ||
          reply.author === 'System' ||
          reply.isAiGenerated === true,
      );

      if (autoReply) {
        return {
          hasReply: true,
          reply: {
            content: autoReply.content,
            author: autoReply.author,
          },
        };
      }
    }

    return { hasReply: false };
  } catch (error: any) {
    // 如果评论不存在（404），可能是被删除
    if (error.response?.status === 404) {
      console.warn(`[自动回复] 评论 ${commentId} 不存在，可能已被删除`);
      return { hasReply: false };
    }

    console.error('[自动回复] 检查评论回复失败:', error);
    throw error;
  }
}

/**
 * 创建自动回复检查回调函数
 */
export function createAutoReplyCheckCallback(
  commentId: string,
): () => Promise<{ hasReply: boolean; reply?: any }> {
  return () => checkCommentReplies(commentId);
}

/**
 * 显示自动回复通知
 */
export function showAutoReplyNotification(reply: {
  content: string;
  author: string;
}): void {
  // 尝试使用现有的toast系统
  if (typeof window !== 'undefined') {
    // 检查是否有toast系统
    const toast = (window as any).toast;
    if (toast && typeof toast.success === 'function') {
      toast.success(`${reply.author} 回复了你的评论`, {
        duration: 5000,
        position: 'bottom-right',
      });
      return;
    }
  }

  // 后备方案：使用console.log
  console.log(`[自动回复] ${reply.author} 回复了你的评论`);
}

/**
 * 工具函数：判断是否为自动回复评论
 */
export function isAutoReplyComment(comment: any): boolean {
  return (
    comment.author === 'Porter' ||
    comment.author === 'System' ||
    comment.isAiGenerated === true ||
    comment.email === 'porter@joyminis.com' ||
    comment.email === 'system@joyminis.com'
  );
}
