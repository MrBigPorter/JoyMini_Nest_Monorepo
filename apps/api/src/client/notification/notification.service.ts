import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import * as admin from 'firebase-admin';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);

  // 定义全员广播的 Topic 名称
  private readonly GLOBAL_TOPIC = 'all_users';
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  // 初始化模块时的逻辑
  onModuleInit() {
    if (!admin.apps.length) {
      const firebaseConfig = this.configService.get<string>(
        'FIREBASE_ADMIN_CREDENTIALS',
      );
      if (!firebaseConfig) {
        this.logger.warn(
          'FIREBASE_CONFIG is not set. Firebase Admin SDK will not be initialized.',
        );
        return;
      }

      try {
        const serviceAccount = JSON.parse(firebaseConfig);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
        this.logger.log('Firebase Admin SDK initialized successfully.');
      } catch (e) {
        this.logger.error(`Failed to initialize Firebase Admin SDK: ${e}`);
      }
    }
  }

  // ---------------------------------------------------------
  // 核心功能 1: 设备上报 (Flutter 启动时调用)
  // ---------------------------------------------------------
  async registerDevice(token: string, platform: string, userId?: string) {
    // 逻辑：如果 Token 存在就更新信息，不存在就创建
    // 这样能保证一个 Token 在库里永远只有一条记录
    const device = await this.prisma.device.upsert({
      where: { token },
      update: {
        platform,
        userId: userId || null, // 允许解绑用户
        lastActive: new Date(),
      },
      create: {
        token,
        platform,
        userId: userId || null,
      },
    });

    // 自动订阅到全员广播 Topic
    // 这样以后发全员通知时，不需要查数据库，直接发给 Topic 即可
    // 2. 【为了广播】把 Token 订阅到 Topic
    // 这一步相当于把用户拉进了“全员群”
    // 以后发广播，不用查库，Firebase 自己知道这个 Topic 下有哪些 Token
    try {
      await admin.messaging().subscribeToTopic(token, this.GLOBAL_TOPIC);
    } catch (e) {
      this.logger.warn(`Failed to subscribe token to global topic: ${e}`);
    }
    return device;
  }

  // ---------------------------------------------------------
  // 核心功能 2: 发送私信 (给指定用户的所有设备发)
  // ---------------------------------------------------------
  async sendPrivateMessage(
    userId: string,
    title: string,
    body: string,
    data?: any,
  ) {
    // 1. 查找用户的所有设备 Token
    const devices = await this.prisma.device.findMany({
      where: { userId },
      select: { token: true },
    });

    if (!devices.length) {
      return this.logger.log(
        `No devices found for user ${userId}. Message not sent.`,
      );
    }
    const tokens = devices.map((d) => d.token);

    this.logger.log(
      `Sending message to user ${userId} on ${tokens.length} devices.`,
    );

    // B. 批量发送
    const message: admin.messaging.MulticastMessage = {
      notification: {
        title,
        body,
      },
      data: data || {}, // 可选的自定义数据
      tokens,
      // 可选：针对不同平台的额外配置
      // 针对安卓的点击跳转配置
      android: {
        priority: 'high', //  加上这一行！强制高优先级
        notification: {
          sound: 'default',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          channelId: 'high_importance_channel', // (可选) 配合前端的高优先级通道
        },
      },
      // 针对 iOS 的配置
      apns: {
        headers: {
          'apns-priority': '10', // 10 代表“立即发送”，5 代表“省电发送”
        },
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            contentAvailable: true, // 允许后台唤醒
          },
        },
      },
    };

    try {
      const response = await admin.messaging().sendEachForMulticast(message);
      this.logger.log(
        `Sent message to user ${userId}: ${response.successCount} successful, ${response.failureCount} failed.`,
      );
      // 处理失败的 Token（如无效 Token）可以在这里进行
      if (response.failureCount > 0) {
        response.responses.forEach((resp, idx) => {
          if (
            !resp.success &&
            resp.error?.code === 'messaging/registration-token-not-registered'
          ) {
            this.deleteInvalidToken(tokens[idx]);
          }
        });
      }
    } catch (error: any) {
      this.logger.error(
        `Error sending message to user ${userId}: ${error.message}`,
      );
    }
  }

  // ---------------------------------------------------------
  // 核心功能 3:  [新增] 全员广播 (Global Broadcast)
  // ---------------------------------------------------------

  async sendBroadcast(title: string, body: string, data?: any) {
    const message: admin.messaging.Message = {
      // 直接发送给 Topic，而不是具体的 Token
      topic: this.GLOBAL_TOPIC,
      notification: {
        title,
        body,
      },
      data: data || {},
      // 可选：针对不同平台的额外配置
      // 针对安卓的点击跳转配置
      android: {
        priority: 'high', //  加上这一行！强制高优先级
        notification: {
          sound: 'default',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          channelId: 'high_importance_channel', // (可选) 配合前端的高优先级通道
        },
      },
      // 针对 iOS 的配置
      apns: {
        headers: {
          'apns-priority': '10', // 10 代表“立即发送”，5 代表“省电发送”
        },
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            contentAvailable: true, // 允许后台唤醒
          },
        },
      },
    };

    try {
      const response = await admin.messaging().send(message);
      this.logger.log(`🚀 全员广播已发送: ${response}`);
      return { success: true, messageId: response };
    } catch (error: any) {
      this.logger.error(`❌ 全员广播发送失败: ${error.message}`);
      throw error;
    }
  }

  // ---------------------------------------------------------
  // 核心功能 4: [新增] 音视频通话专属锁屏唤醒 (纯 Data 推送)
  // ---------------------------------------------------------
  async sendCallWakeUpPush(
    targetUserId: string,
    callData: {
      /** 'call_invite' | 'call_end'，必须透传；不能硬编码为 'call_invite' */
      type?: string;
      sessionId?: string;
      senderId?: string;
      mediaType?: string;
      /** CallKit 显示来电界面需要，若未传则自动从数据库查询 */
      senderName?: string;
      senderAvatar?: string;
      /** 可选，用于拒接时 Flutter 发送 call_end 带上 conversationId */
      conversationId?: string;
    },
  ) {
    // 1. 查找用户的所有设备 Token
    const devices = await this.prisma.device.findMany({
      where: { userId: targetUserId },
      select: { token: true },
    });

    if (!devices.length) return;
    const tokens = devices.map((d) => d.token);

    // 2. 补查发送方信息（CallKit 来电界面需要展示呼叫方姓名/头像）
    let senderName = callData.senderName || '';
    let senderAvatar = callData.senderAvatar || '';
    if (callData.senderId && (!senderName || !senderAvatar)) {
      try {
        const sender = await this.prisma.user.findUnique({
          where: { id: callData.senderId },
          select: { nickname: true, avatar: true },
        });
        senderName = sender?.nickname || '';
        senderAvatar = sender?.avatar || '';
      } catch {
        // 查询失败不阻断推送，保持空字符串
      }
    }

    // 3. 构造纯 Data 且最高优先级的 Payload
    const message: admin.messaging.MulticastMessage = {
      tokens,
      //  命脉 1：绝对不能写 notification 字段！只能写 data！
      data: {
        // 使用事件携带的 type（call_invite / call_end），不能硬编码为 'call_invite'
        // 若 handleCallEnd 触发此路径时硬编码为 'call_invite'，会让 App 看到幽灵来电屏幕
        type: String(callData.type || 'call_invite'),
        sessionId: callData.sessionId || '',
        senderId: callData.senderId || '',
        mediaType: callData.mediaType || '',
        senderName,
        senderAvatar,
        conversationId: callData.conversationId || '',
        timestamp: String(Date.now()), // Data 只能传字符串
      },
      //  命脉 2：安卓必须强制 High 优先级，穿透 Doze 锁屏休眠
      android: {
        priority: 'high',
      },
      //  命脉 3：iOS 必须是 High 优先级 + 静默推送唤醒
      apns: {
        headers: {
          'apns-priority': '10', // 10 代表立即投递
          'apns-push-type': 'background', // 声明为后台唤醒推送
        },
        payload: {
          aps: {
            contentAvailable: true, // 允许后台唤醒 Flutter
          },
        },
      },
    };

    try {
      const response = await admin.messaging().sendEachForMulticast(message);
      this.logger.log(
        ` [Call WakeUp] Sent to ${targetUserId}: ${response.successCount} success`,
      );
    } catch (error: any) {
      this.logger.error(`[Call WakeUp Error] ${error.message}`);
    }
  }

  // 删除无效的设备 Token
  private async deleteInvalidToken(token: string) {
    await this.prisma.device
      .deleteMany({
        where: { token },
      })
      .catch((error) => {}); // 忽略删除错误
    this.logger.log(`Deleted invalid device token: ${token}`);
  }
}
