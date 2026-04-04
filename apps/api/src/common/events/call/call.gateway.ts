import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Inject, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import {
  CallAcceptDto,
  CallEndDto,
  CallIceCandidateDto,
  CallInviteDto,
} from '@api/common/events/call/dto/call-signaling.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ChatService } from '@api/common/chat/chat.service';
import { RedisService } from '@api/common/redis/redis.service';
import { v4 as uuidv4 } from 'uuid';
import { CallEndReason, CallMediaType, MESSAGE_TYPE } from '@lucky/shared';

// pending_call:{userId} 的 Redis TTL（秒），与来电超时对齐
const PENDING_CALL_TTL_SEC = 60;

@WebSocketGateway({
  namespace: '/events',
  cors: { origin: '*' },
})
export class CallGateway {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(CallGateway.name);
  constructor(
    private readonly eventEmitter: EventEmitter2,
    @Inject(ChatService) private readonly chatService: ChatService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * 辅助方法：安全获取当前 Socket 的用户 ID
   * (该 ID 是由 EventsGateway 在 handleConnection 时挂载的)
   */
  private getUserId(client: Socket): string | null {
    const data = client.data as Record<string, unknown>;
    return typeof data.userId === 'string' ? data.userId : null;
  }

  // ==========================================
  // 1. 发起呼叫 (Invite)
  // ==========================================
  @SubscribeMessage('call_invite')
  async handleCallInvite(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CallInviteDto,
  ) {
    const senderId = this.getUserId(client);
    if (!senderId) {
      this.logger.warn(
        `Call Invite rejected: No User ID on socket ${client.id}`,
      );
      return;
    }

    this.logger.log(
      ` [Call Invite] ${senderId} -> ${payload.targetId} (Session: ${payload.sessionId})`,
    );

    // 目标用户的私有房间名 (与 EventsGateway 保持一致)
    const targetRoom = `user_${payload.targetId}`;

    const invitePayload = { ...payload, senderId };

    // 缓存到 Redis：FCM 唤醒后重连时补投（竞态兜底）
    await this.redisService.set(
      `pending_call:${payload.targetId}`,
      JSON.stringify(invitePayload),
      PENDING_CALL_TTL_SEC,
    );

    // 转发消息给目标（若已在线则直接收到）
    const roomClients = (this.server as any).adapter?.rooms?.get(targetRoom);
    const onlineCount = roomClients ? roomClients.size : 0;
    this.logger.log(
      `[Call Invite] target room "${targetRoom}" has ${onlineCount} socket(s)`,
    );
    this.server.to(targetRoom).emit('call_invite', invitePayload);

    // 预取会话 ID（用于 FCM payload，让 Flutter 拒接时能带上 conversationId）
    let conversationId: string | undefined;
    try {
      const conv = await this.chatService.ensureDirectConversation(
        senderId,
        payload.targetId,
      );
      conversationId = conv.id;
    } catch {
      // 查询失败不阻断信令，conversationId 留 undefined
    }

    this.eventEmitter.emit('call.wake_up', {
      type: 'call_invite', // 显式传递，不依赖 push.listener 的默认值
      targetId: payload.targetId,
      sessionId: payload.sessionId,
      senderId: senderId,
      mediaType: payload.mediaType,
      conversationId,
    });
  }

  // ==========================================
  // 2. 接听呼叫 (Accept/Answer)
  // ==========================================
  @SubscribeMessage('call_accept')
  handleCallAccept(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CallAcceptDto,
  ) {
    const senderId = this.getUserId(client);
    if (!senderId) {
      this.logger.warn(
        `Call Accept rejected: No User ID on socket ${client.id}`,
      );
      return;
    }

    this.logger.log(
      ` [Call Accept] ${senderId} -> ${payload.targetId} (Session: ${payload.sessionId})`,
    );

    const targetRoom = `user_${payload.targetId}`;

    // 转发 Answer SDP 给发起方
    this.server.to(targetRoom).emit('call_accept', {
      ...payload, // 包含 sdp, sessionId
      senderId,
    });
  }

  // ==========================================
  // 3. ICE 候选者交换 (Ice Candidate)
  // ==========================================
  @SubscribeMessage('call_ice')
  handleIceCandidate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CallIceCandidateDto,
  ) {
    const senderId = this.getUserId(client);
    if (!senderId) return;

    // ICE 交换非常频繁，通常仅在 debug 模式下打印日志，或者不打印
    this.logger.debug(`❄️ [ICE] ${senderId} -> ${payload.targetId}`);

    const targetRoom = `user_${payload.targetId}`;

    this.server.to(targetRoom).emit('call_ice', {
      ...payload, // 包含 candidate, sdpMid, sdpMLineIndex
      senderId,
    });
  }

  // ==========================================
  // 4. 挂断/拒绝/取消 (End)
  // ==========================================
  @SubscribeMessage('call_end')
  async handleCallEnd(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CallEndDto,
  ) {
    const senderId = this.getUserId(client);
    if (!senderId) return;

    this.logger.log(
      ` [Call End] ${senderId} -> ${payload.targetId} (Reason: ${payload.reason})`,
    );

    const targetRoom = `user_${payload.targetId}`;
    this.server.to(targetRoom).emit('call_end', {
      ...payload, // 包含 reason, sessionId
      senderId,
    });

    // 清除 Redis 缓存（无论主被叫谁挂断）
    await this.redisService.del(`pending_call:${payload.targetId}`);
    await this.redisService.del(`pending_call:${senderId}`);

    // 发送通话结束消息到聊天
    await this.sendCallEndMessage(senderId, payload);

    // type: 'call_end' 必须透传，push.listener → sendCallWakeUpPush 会把它写入 FCM data.type
    // 如果漏传，FCM data.type 会被硬编码为 'call_invite'，App 收到后显示幽灵来电屏幕
    this.eventEmitter.emit('call.wake_up', {
      targetId: payload.targetId,
      sessionId: payload.sessionId,
      senderId: senderId,
      mediaType: payload.mediaType ?? 'audio',
      type: 'call_end',
    });
  }

  /**
   * 发送通话结束消息到聊天
   */
  private async sendCallEndMessage(callerId: string, payload: CallEndDto) {
    try {
      const { targetId, reason, conversationId } = payload;
      const duration = payload.duration || 0;
      const mediaType = payload.mediaType || 'audio'; // 兜底为语音

      const mediaTypeText =
        mediaType === CallMediaType.VIDEO ? 'Video' : 'Audio';
      let content = '';

      //  重点修改这里：使用 CallEndReason 枚举进行比较
      if (reason === CallEndReason.MISSED) {
        content = '[Missed]';
      } else if (reason === CallEndReason.REJECTED) {
        content = '[Rejected]';
      } else if (duration > 0) {
        // 正常通话结束
        const durationText = this.formatDuration(duration);
        content = `[${mediaTypeText}Call] Time ${durationText}`;
      } else {
        // 时长为0，且不是未接/拒绝，说明是发起方提前取消
        content = '[Cancelled]';
      }

      // 2. 拿到会话 ID
      const conversation = conversationId
        ? { id: conversationId }
        : await this.chatService.ensureDirectConversation(callerId, targetId);

      // 3. 复用现有的 sendMessage 落库并广播
      await this.chatService.sendMessage(callerId, {
        id: uuidv4(),
        conversationId: conversation.id,
        type: MESSAGE_TYPE.SYSTEM,
        content,
        meta: {
          callType: mediaType,
          duration: duration,
          startedAt: payload.startedAt,
          sessionId: payload.sessionId,
          reason: reason,
          isSystemCallEnd: true,
        },
      });

      this.logger.log(
        `通话记录已生成: ${callerId} -> ${targetId}, 状态: ${content}`,
      );
    } catch (error) {
      this.logger.error(`生成通话记录失败: ${error}`);
    }
  }

  /**
   * 格式化时长（秒 -> 时分秒）
   */
  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h${minutes}m${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m${secs}s`;
    } else {
      return `${secs}s`;
    }
  }
}
