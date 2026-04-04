import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { RedisService } from '@api/common/redis/redis.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SocketEvents } from '@lucky/shared';
import {
  CHAT_EVENTS,
  MessageCreatedEvent,
} from '@api/common/chat/events/chat.events';
import type { Prisma } from '@prisma/client';

interface JwtPayloadLike {
  sub?: string;
}

const extractErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const getSocketUserId = (client: Socket): string | null => {
  const data = client.data as Record<string, unknown>;
  return typeof data.userId === 'string' ? data.userId : null;
};

const setSocketUserId = (client: Socket, userId: string): void => {
  const data = client.data as Record<string, unknown>;
  data.userId = userId;
};

const isConversationSeqRows = (
  value: unknown,
): value is Array<{ lastMsgSeqId: number }> =>
  Array.isArray(value) &&
  value.every((item) => {
    if (typeof item !== 'object' || item === null) {
      return false;
    }

    const row = item as Record<string, unknown>;
    return typeof row.lastMsgSeqId === 'number';
  });

export enum SocketRoom {
  LOBBY = 'group_lobby', // 拼团大厅
}

// 定义推送子类型
export enum PushEventType {
  GROUP_SUCCESS = 'group_success',
  GROUP_FAILED = 'group_failed',
}

@WebSocketGateway({
  namespace: '/events',
  cors: {
    origin: '*', // 解决开发环境跨域
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: any;

  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prismaService: PrismaService,
    private readonly redisService: RedisService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        (typeof client.handshake.query.token === 'string'
          ? client.handshake.query.token
          : undefined) ||
        (typeof client.handshake.auth?.token === 'string'
          ? client.handshake.auth.token
          : undefined);

      let userId: string | null = null;
      if (token) {
        // Try client JWT secret first, then admin JWT secret
        const secrets = [
          process.env.JWT_SECRET || 'please_change_me_very_secret',
          process.env.ADMIN_JWT_SECRET,
        ].filter(Boolean) as string[];

        for (const secret of secrets) {
          try {
            const payload = this.jwtService.verify<JwtPayloadLike>(token, {
              secret,
            });
            userId = typeof payload.sub === 'string' ? payload.sub : null;
            this.logger.debug(` User verified via JWT: ${userId}`);
            break;
          } catch {
            // try next secret
          }
        }

        if (userId) {
          const privateRoom = `user_${userId}`;
          await client.join(privateRoom);
          setSocketUserId(client, userId);
          this.logger.log(
            `🔌 Client connected: ${client.id} (User: ${userId})`,
          );

          // 补投：FCM 唤醒后重连时，若有待接来电则立即推给该 socket
          try {
            const pendingCall = await this.redisService.get(
              `pending_call:${userId}`,
            );
            if (pendingCall) {
              client.emit('call_invite', JSON.parse(pendingCall));
              this.logger.log(
                `📞 [Call Invite REPLAY] -> ${userId} (socket: ${client.id})`,
              );
            }
          } catch (e) {
            this.logger.warn(`[Call Invite REPLAY] Redis error: ${String(e)}`);
          }
        }
      }
    } catch (error: unknown) {
      this.logger.error(`Connection error: ${extractErrorMessage(error)}`);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  // ---------------------------------------------------------
  // 核心：统一分发方法 (Unified Dispatcher)
  // ---------------------------------------------------------

  /**
   * 所有业务指令的最终出口，前端只监听 SocketEvents.DISPATCH ('dispatch')
   */
  dispatch(room: string, type: string, data: unknown, excludeRoom?: string) {
    const roomClients = this.server.adapter.rooms.get(room);
    const clientCount = roomClients ? roomClients.size : 0;

    // 记录数据摘要（避免日志过大）
    const dataSummary =
      typeof data === 'object' && data !== null
        ? JSON.stringify(data).substring(0, 200) +
          (JSON.stringify(data).length > 200 ? '...' : '')
        : String(data);

    if (excludeRoom) {
      this.server
        .to(room)
        .except(excludeRoom) // 排除特定房间（如已在房间内的人）
        .emit(SocketEvents.DISPATCH, {
          type, // 对应前端的业务识别码，如 'chat_message'
          data, // 实际数据载荷
        });

      this.logger.debug(
        `[Dispatch] To: ${room} (${clientCount} clients, exclude: ${excludeRoom}), ` +
          `Type: ${type}, Data: ${dataSummary}`,
      );
    } else {
      this.server.to(room).emit(SocketEvents.DISPATCH, {
        type, // 对应前端的业务识别码，如 'chat_message'
        data, // 实际数据载荷
      });

      this.logger.debug(
        `[Dispatch] To: ${room} (${clientCount} clients), ` +
          `Type: ${type}, Data: ${dataSummary}`,
      );
    }
  }

  // ---------------------------------------------------------
  // 业务通知逻辑 (重构为调用 dispatch)
  // ---------------------------------------------------------

  broadcastToLobby(payload: unknown) {
    // 统一走 dispatch 出口，类型设为 GROUP_UPDATE
    this.dispatch(SocketRoom.LOBBY, SocketEvents.GROUP_UPDATE, payload);
  }

  notifyUser(userId: string, type: string, payload: unknown) {
    const privateRoom = `user_${userId}`;
    this.dispatch(privateRoom, type, payload);
  }

  dispatchToUser(userId: string, type: string, data: unknown) {
    const privateRoom = `user_${userId}`;
    // 直接复用 dispatch 逻辑，发送到该用户的私有房间
    this.dispatch(privateRoom, type, data);
  }

  // ---------------------------------------------------------
  // IM 聊天监听逻辑
  // ---------------------------------------------------------

  @SubscribeMessage(SocketEvents.JOIN_CHAT)
  async handleJoinChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ) {
    // 处理数组格式: ["join_chat", { conversationId: "..." }]
    let conversationId: string | null = null;

    if (Array.isArray(payload) && payload.length === 2) {
      // 数组格式: 第一个元素是事件名，第二个是数据
      const data = payload[1];
      if (
        typeof data === 'object' &&
        data !== null &&
        'conversationId' in data
      ) {
        conversationId = String(data.conversationId);
      }
    } else if (
      typeof payload === 'object' &&
      payload !== null &&
      'conversationId' in payload
    ) {
      // 对象格式: { conversationId: "..." }
      conversationId = String(payload.conversationId);
    }

    if (!conversationId) {
      this.logger.warn(
        `[Join Chat] Invalid payload format: ${JSON.stringify(payload)}`,
      );
      return;
    }

    const userId = getSocketUserId(client);
    const clientId = client.id;
    const roomName = conversationId;

    // 检查客户端是否已经在房间中
    const rooms = Array.from(client.rooms);
    const isAlreadyInRoom = rooms.includes(roomName);

    // 使用 await 确保加入房间成功
    await client.join(roomName);

    // 👈 修改点：去掉了多余的 .sockets
    const roomClients = this.server.adapter.rooms.get(roomName);
    const clientCount = roomClients ? roomClients.size : 0;

    this.logger.debug(
      `[Join Chat] Client: ${clientId}, User: ${userId || 'unknown'}, ` +
        `Room: ${roomName}, Already in room: ${isAlreadyInRoom}, ` +
        `Room clients after join: ${clientCount}, Payload format: ${Array.isArray(payload) ? 'array' : 'object'}`,
    );

    return { status: 'joined', conversationId };
  }

  @SubscribeMessage(SocketEvents.LEAVE_CHAT)
  handleLeaveChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ) {
    // 处理数组格式: ["leave_chat", { conversationId: "..." }]
    let conversationId: string | null = null;

    if (Array.isArray(payload) && payload.length === 2) {
      // 数组格式: 第一个元素是事件名，第二个是数据
      const data = payload[1];
      if (
        typeof data === 'object' &&
        data !== null &&
        'conversationId' in data
      ) {
        conversationId = String(data.conversationId);
      }
    } else if (
      typeof payload === 'object' &&
      payload !== null &&
      'conversationId' in payload
    ) {
      // 对象格式: { conversationId: "..." }
      conversationId = String(payload.conversationId);
    }

    if (!conversationId) {
      this.logger.warn(
        `[Leave Chat] Invalid payload format: ${JSON.stringify(payload)}`,
      );
      return;
    }

    void client.leave(conversationId);

    this.logger.debug(
      `[Leave Chat] Client: ${client.id}, Room: ${conversationId}`,
    );
  }

  @SubscribeMessage(SocketEvents.SEND_MESSAGE)
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      conversationId: string;
      content: string;
      type: number;
      tempId: string;
    },
  ) {
    const userId = getSocketUserId(client);
    if (!userId) return { error: 'Unauthorized' };

    const { conversationId, content, type, tempId } = payload;

    try {
      const result = await this.prismaService.$transaction(
        async (tx: Prisma.TransactionClient) => {
          await tx.conversation.updateMany({
            where: { id: conversationId },
            data: { lastMsgSeqId: { increment: 1 } },
          });

          const conversationRowsUnknown =
            await (tx.$queryRaw`SELECT "lastMsgSeqId" FROM "Conversation" WHERE "id" = ${conversationId} LIMIT 1` as Promise<unknown>);
          const seqId = isConversationSeqRows(conversationRowsUnknown)
            ? (conversationRowsUnknown[0]?.lastMsgSeqId ?? 0)
            : 0;

          const msg = await tx.chatMessage.create({
            data: {
              conversationId,
              senderId: userId,
              content,
              type,
              seqId,
              clientTempId: tempId,
            },
            include: { sender: true },
          });

          await tx.conversation.update({
            where: { id: conversationId },
            data: {
              lastMsgContent: type === 0 ? content : '[Media]',
              lastMsgType: type,
              lastMsgTime: new Date(),
            },
          });
          return msg;
        },
      );

      this.dispatch(conversationId, SocketEvents.CHAT_MESSAGE, {
        ...result,
        isSelf: false, // 告知房间内其他人此消息非本人发送
      });

      // 触发完整的消息分发链：user_X 私有房间 + FCM 离线推送
      // (修复：WebSocket 路径之前只派发到 conversationId 房间，
      //  未在 join_chat 的接收方永远收不到消息)
      const members = await this.prismaService.chatMember.findMany({
        where: { conversationId },
        select: { userId: true, isMuted: true },
      });
      const memberIds = members.map((m) => m.userId);
      const pushMemberIds = members
        .filter((m) => !m.isMuted)
        .map((m) => m.userId);

      this.eventEmitter.emit(
        CHAT_EVENTS.MESSAGE_CREATED,
        new MessageCreatedEvent(
          result.id,
          result.conversationId,
          result.content,
          result.type,
          result.senderId ?? '',
          result.sender?.nickname ?? '',
          result.sender?.avatar ?? '',
          result.createdAt.getTime(),
          memberIds,
          result.seqId,
          result.meta,
          undefined,
          undefined,
          pushMemberIds,
        ),
      );

      return {
        status: 'ok',
        data: {
          id: result.id,
          seqId: result.seqId,
          tempId: tempId,
          createdAt: result.createdAt,
        },
      };
    } catch (error: unknown) {
      const message = extractErrorMessage(error);
      this.logger.error(`Send Message Failed: ${message}`);
      return { status: 'error', message };
    }
  }

  @SubscribeMessage('join_lobby')
  handleJoinLobby(@ConnectedSocket() client: Socket) {
    void client.join(SocketRoom.LOBBY);
  }

  @SubscribeMessage('leave_lobby')
  handleLeaveLobby(@ConnectedSocket() client: Socket) {
    void client.leave(SocketRoom.LOBBY);
  }
}
