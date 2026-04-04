import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from '../notification.service';
import {
  CHAT_EVENTS,
  MessageCreatedEvent,
} from '@api/common/chat/events/chat.events';
import { MESSAGE_TYPE } from '@lucky/shared';

@Injectable()
export class PushListener {
  private readonly logger = new Logger(PushListener.name);

  constructor(private readonly notificationService: NotificationService) {}

  //  异步执行：不阻塞主线程发消息
  @OnEvent(CHAT_EVENTS.MESSAGE_CREATED, { async: true })
  async handleFcmPush(event: MessageCreatedEvent) {
    //  核心修改 1：优先使用过滤了免打扰的 pushMemberIds。如果没传，回退到 memberIds 防报错。
    const targetIds = event.pushMemberIds || event.memberIds || [];

    // 1. 熔断检查：如果 targetIds 为空 (说明是大群熔断，或者所有人刚好都开了免打扰)，直接跳过
    if (targetIds.length === 0) {
      this.logger.debug(
        `[FCM] Skip push for empty target list (Large Group or All Muted): ${event.conversationId}`,
      );
      return;
    }

    this.logger.debug(`[FCM] Processing push for message: ${event.messageId}`);

    try {
      // 1. 获取预览文本
      const previewText = this._getPreviewText(event.type, event.content);

      // 3. 性能优化：将“串行等待”改为“并发执行”
      //  核心修改 2：用过滤后的 targetIds 替代原来的 event.memberIds 进行遍历发推送！
      const pushPromises = targetIds.map(async (targetId) => {
        if (targetId === event.senderId) return;

        return this.notificationService.sendPrivateMessage(
          targetId,
          event.senderName,
          previewText,
          {
            type: 'chat',
            id: event.conversationId,
            title: event.senderName,
            body: previewText,
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
          },
        );
      });

      // 并发等待所有请求完成 (几百人也就是几百毫秒的事)
      await Promise.allSettled(pushPromises);
    } catch (e) {
      this.logger.error(`[FCM Push Error] ${e}`);
    }
  }

  @OnEvent('call.wake_up', { async: true })
  async handleCallWakeUp(event: {
    targetId: string;
    sessionId: string;
    senderId: string;
    mediaType?: string;
    /** 'call_invite' | 'call_end' — 必须透传给 FCM payload，
     *  否则 call_end 时会向 App 发送错误的 'call_invite' FCM，
     *  导致 App 出现幽灵来电屏幕，后续来电无法正常接收 */
    type?: string;
    /** CallKit 来电界面显示的呼叫方姓名（由 notification.service 自动查补） */
    senderName?: string;
    /** CallKit 来电界面显示的呼叫方头像 URL */
    senderAvatar?: string;
    /** 可选，拒接时 Flutter 发 call_end 需要 */
    conversationId?: string;
  }) {
    this.logger.debug(
      `[FCM] Processing call wake up for target: ${event.targetId}`,
    );
    try {
      // 调用 NotificationService 专属的唤醒方法
      await this.notificationService.sendCallWakeUpPush(event.targetId, event);
    } catch (e) {
      this.logger.error(`[FCM Call WakeUp Error] ${e}`);
    }
  }

  // 简单的预览文本生成器 (可以提取为 Shared Util)
  private _getPreviewText(type: number, content: string): string {
    switch (type) {
      case MESSAGE_TYPE.TEXT:
        return content;
      case MESSAGE_TYPE.IMAGE:
        return '[Image]';
      case MESSAGE_TYPE.AUDIO:
        return '[Voice]';
      case MESSAGE_TYPE.VIDEO:
        return '[Video]';
      case MESSAGE_TYPE.FILE:
        return '[File]';
      case MESSAGE_TYPE.LOCATION:
        return '[Location]';
      case 99: //  适配系统消息
        return `[System] ${content}`;
      default:
        return '[Message]';
    }
  }
}
