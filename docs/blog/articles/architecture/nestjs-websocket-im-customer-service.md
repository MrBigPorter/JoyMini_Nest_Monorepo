---
title: NestJS WebSocket IM 客服系统：从群聊危机到 Virtual Agent 多渠道架构
slug: nestjs-websocket-im-customer-service
tags: WebSocket, NestJS, IM, Architecture, Real-time
---

# NestJS WebSocket IM 客服系统：从群聊危机到 Virtual Agent 多渠道架构

## 1. 引言

> 某天用户反馈：「我在客服聊天窗口看到了别人的聊天记录。」——这是一个电商客服系统最不应该发生的事。

本文记录了一个基于 NestJS Socket.IO 的 IM 客服系统从出现到重构的全过程，包含：

- **Phase 1**：排查并修复实时分发 Bug，让 Admin 端能实时感知客服会话
- **Phase 2**：通过 Virtual Agent 模式彻底解决用户隔离问题，并设计多客服渠道管理架构

---

## 2. 架构演进背景

### 2.1 电商客服的正确模型

现实中的电商客服（Taobao、Amazon）工作方式：

```
张三  ──私聊──▶  [官方客服]  ◀── Admin A / Admin B / AI 随时接管
李四  ──私聊──▶  [官方客服]
王五  ──私聊──▶  [官方客服]
```

- 每个用户有**独立的 1-on-1 私聊包间**，互相完全隔离
- `official_lucky_support` 是对外展示的统一客服身份
- Admin 在后台看到所有用户的独立会话列表，点进去只和那一个用户聊
- 未来接入 AI Agent 时，AI 披同一个身份无缝替换

### 2.2 当前系统存在的三层叠加缺陷

| 层 | 缺陷 | 后果 |
|---|---|---|
| **Schema** | `businessId String? @unique` | 全库只能有 1 条 `official_platform_support_v1` 会话 |
| **Service** | `ensureBusinessConversation` 按 businessId 查找后 upsert member | 所有用户被塞进同一个群 |
| **Reply** | `senderId: null` + 直接 `eventsGateway.dispatch` | FCM 离线推送失效、退后台收不到消息 |

**结果**：任何客户打开客服，都能看到所有其他客户的聊天记录——群聊而非私聊。

---

## 3. Phase 1：实时分发修复（已完成）

### 3.1 排查发现的两个 Bug

| # | 位置 | 问题 |
|---|---|---|
| 1 | `CustomerServiceDesk.tsx` | 会话列表查询 `type: 'SUPPORT'`，但 Flutter 创建的是 `BUSINESS` 类型，永远查不到 |
| 2 | 后端 `ChatService` | Flutter 开启会话时（未发消息）不触发任何事件，Admin 只能靠 30s 轮询感知 |

### 3.2 修复后的数据流

```
Flutter 点击「联系客服」
  │
  ▼
GET /api/v1/chat/business?businessId=official_platform_support_v1
  │
  ▼
ChatService.addMemberToBusinessGroup()
  ├─ ensureBusinessConversation() → 查找/创建 BUSINESS 类型会话
  ├─ chatMember.upsert()          → 将用户加为成员
  └─ isNewMember === true?
       │
       ▼
     EventEmitter.emit(SUPPORT_CONVERSATION_STARTED)
       │
       ▼
     SocketListener.handleSupportConversationStarted()
       └─ 查所有 status=1 的 AdminUser
          └─ dispatch(`user_${adminId}`, 'support_new_conversation')
               │
               ▼
             useChatSocket → 'support_new_conversation' → refreshList()

用户发消息
  │
  ▼
ChatService.sendMessage() → EventEmitter.emit(MESSAGE_CREATED)
  │
  ▼
SocketListener.handleMessageCreated()
  ├─ dispatch 到会话房间
  └─ BUSINESS + official_platform_support_v1
       └─ dispatch 到所有在线 admin 私有房间
```

### 3.3 关键代码改动

#### 新增事件常量

```typescript
// src/common/chat/events/chat.events.ts
SUPPORT_CONVERSATION_STARTED: "chat.support.conversation.started";

class SupportConversationStartedEvent {
  conversationId: string;
  businessId: string;
  userId: string;
}
```

#### ChatService 触发事件

```typescript
async addMemberToBusinessGroup(businessId: string, userId: string) {
  const conversation = await this.ensureBusinessConversation(businessId);
  const existingMember = await this.prisma.chatMember.findUnique(...);
  const isNewMember = !existingMember;

  await this.prisma.chatMember.upsert(...);

  // 首次加入官方客服 → 通知 admin
  if (isNewMember && businessId === 'official_platform_support_v1') {
    this.eventEmitter.emit(CHAT_EVENTS.SUPPORT_CONVERSATION_STARTED, ...);
  }
}
```

#### Socket Listener 分发给所有 Admin

```typescript
@OnEvent(CHAT_EVENTS.SUPPORT_CONVERSATION_STARTED)
async handleSupportConversationStarted(event) {
  const admins = await this.prismaService.adminUser.findMany({
    where: { status: 1, deletedAt: null },
    select: { id: true },
  });
  admins.forEach((admin) => {
    this.eventsGateway.dispatch(
      `user_${admin.id}`,
      'support_new_conversation',
      payload,
    );
  });
}
```

> Admin 连接 Socket 时自动加入 `user_${adminId}` 私有房间（`EventsGateway.handleConnection` 已处理），无需手动 `join_chat`。

#### Admin 前端一行修复

```diff
- type: 'SUPPORT',
+ type: 'BUSINESS',
```

### 3.4 两条实时通知路径

| 场景 | 触发时机 | Socket 事件 | Admin 端响应 |
|---|---|---|---|
| 用户开启客服（未发消息） | `GET /chat/business` 首次调用 | `support_new_conversation` | 会话列表刷新 |
| 用户发消息 | `POST /chat/message` | `chat_message` | 收到消息 + 列表更新 |

> **兜底**：Admin 客服台保留 30s 轮询（`pollingInterval: 30000`），Socket 断连时降级保障。

---

## 4. Phase 2：Virtual Agent + 多客服渠道

> **目标**：彻底解决群聊隔离问题，支持后台动态新增客服渠道，同时打通 FCM 离线推送并为 AI Agent 接入奠基。

### 4.1 核心思路

在 `User` 表中使用虚拟客服账号（`isRobot=true`），把每个用户会话改为 **用户 ↔ 虚拟客服 bot 的 1v1 SUPPORT 会话**。

```
现状（群聊）：
  张三 ──┐
  李四 ──┼──▶ [同一个 BUSINESS 会话] ← 所有人共享 ❌
  王五 ──┘

目标（1v1 包间）：
  张三 ──▶ [SUPPORT 会话 A] ◀──▶ bot_lucky_general
  李四 ──▶ [SUPPORT 会话 B] ◀──▶ bot_lucky_general
  王五 ──▶ [SUPPORT 会话 C] ◀──▶ bot_lucky_tech

  Admin A/B/C 在后台代发：
  chatService.sendMessage(<botUserId>, dto)
    └─ meta: { realAdminId, agentName }  ← 审计与追责
```

### 4.2 选型决策：为何用 SUPPORT 类型

| 选项 | 会话类型 | Schema 改动 | Admin 侧查询 | 结论 |
|---|---|---|---|---|
| A | `DIRECT` | 无 | 需改查询类型 | 语义不准确 |
| B | `BUSINESS`（修 @unique） | 需 migrate | 无需改 | 有迁移风险 |
| **C** | **`SUPPORT`** | **无** | **改默认查询为 SUPPORT** | **最优** |

选择 `SUPPORT` 的原因：
- 与客服语义一致
- 不与拼团/业务会话混用
- 可直接承接多渠道方案（`businessId -> SupportChannel -> botUserId`）

### 4.3 SupportChannel Schema 设计

```prisma
model SupportChannel {
  /// 渠道 ID，同时作为 Flutter 端传入的 businessId
  id          String   @id @default(cuid())
  /// 渠道显示名称（英文）
  name        String   @db.VarChar(100)
  /// 渠道描述（Admin 后台可见，不对外展示）
  description String?  @db.VarChar(255)
  /// 对应的虚拟 bot User ID
  botUserId   String   @unique
  botUser     User     @relation(fields: [botUserId], references: [id])
  /// 软停用开关（不可硬删除：历史 ChatMessage 引用 botUserId）
  isActive    Boolean  @default(true)

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("support_channels")
}
```

> **为什么不能硬删除渠道**：`botUserId` 被所有历史 `ChatMessage.senderId` 引用，删除 User 会触发外键约束报错或级联清空消息记录。只能软停用（`isActive: false`）。

### 4.4 三层数据通道设计

#### 第一层：建立会话——客户点击「联系客服」

```
Flutter 点击「联系客服」
  └─ GET /api/v1/chat/business?businessId=official_platform_support_v1
       └─ 后端查 SupportChannel 表找到虚拟 bot (official_lucky_support)

  └─ 创建 1v1 SUPPORT 会话
       ├─ 会话类型：SUPPORT（不是共享群 BUSINESS）
       ├─ 成员列表：[用户 + bot] 只有这两个人
       └─ 会话名称：'Lucky Support'（英文，对用户展示）

  └─ 🔔 后台实时事件：SUPPORT_CONVERSATION_STARTED
       └─ Socket 通知所有在线 Admin：有新客户进来了
```

**为什么这样设计**：每个用户独立 1v1 会话，客户发消息前就通知 Admin，实现零延迟响应。

#### 第二层：客户发消息——实时推送给 Admin

```
用户 → 发消息
  └─ POST /api/v1/chat/message
       ├─ senderId = 用户ID
       └─ 事件触发：MESSAGE_CREATED

  └─ 后端自动分发
       ├─ 找到会话的两个成员：[用户, bot]
       ├─ 只发给 bot 的方向（跳过自推）
       └─ Socket dispatch 到 admin 的私有房间

  └─ Admin 客服台收到 Socket 事件
       ├─ 刷新会话列表（显示最新消息）
       └─ 如果已打开聊天窗口，实时显示客户消息
```

**为什么这样设计**：消息走标准流程，所有在线 Admin 都能收到，离线 Admin 后登录时自动同步消息历史。

#### 第三层：Admin 回复——通过虚拟 bot 代发

```
Admin 在客服台回复
  └─ POST /admin/chat/conversations/:id/reply

  └─ 后端不再直接发送，而是用虚拟 bot 代发
       ├─ sendMessage(botId='official_lucky_support', {
       │   conversationId,
       │   content: '请稍等，马上为您处理',
       │   meta: { realAdminId, agentName }  ← 审计与追责
       │ })
       ├─ 消息看起来来自 'Lucky Support'（对用户而言）
       └─ 但后台记录了真实 Admin ID

  └─ MESSAGE_CREATED 再次触发
       └─ Socket dispatch 到客户的私有房间
       └─ Flutter 收到 → 实时显示 Admin 消息
```

**为什么这样设计**：
- Admin 消息带有真实身份元数据（`meta.realAdminId`）
- FCM 离线推送自动生效（bot 是真实用户，通知流程完整）
- AI Agent 未来接入时零改动，和 Admin 回复用同一套代码

### 4.5 ChatService 改造：查表替换硬编码

```typescript
async addMemberToBusinessGroup(businessId: string, userId: string) {
  // 1. 查渠道，获取对应 botUserId（不再硬编码）
  const channel = await this.prisma.supportChannel.findUnique({
    where: { id: businessId },
    include: { botUser: { select: { avatar: true, nickname: true } } },
  });
  if (!channel || !channel.isActive) {
    throw new NotFoundException(`Support channel not found or inactive`);
  }

  // 2. 查找该用户与此 bot 是否已有 SUPPORT 会话
  const existing = await this.prisma.conversation.findFirst({
    where: {
      type: CONVERSATION_TYPE.SUPPORT,
      AND: [
        { members: { some: { userId } } },
        { members: { some: { userId: channel.botUserId } } },
      ],
    },
    include: { members: { where: { userId }, take: 1 } },
  });
  if (existing) return existing.members[0];

  // 3. 事务建联：创建 SUPPORT 会话 + 两个成员
  const member = await this.prisma.$transaction(async (tx) => {
    const conv = await tx.conversation.create({
      data: {
        type:    CONVERSATION_TYPE.SUPPORT,
        name:    channel.name,                  // "Lucky Support" / "Tech Support"
        avatar:  channel.botUser?.avatar ?? '',
        status:  ConversationStatus.NORMAL,
        members: {
          create: [
            { userId,                    role: ChatMemberRole.MEMBER },
            { userId: channel.botUserId, role: ChatMemberRole.MEMBER },
          ],
        },
      },
      include: { members: { where: { userId }, take: 1 } },
    });
    return conv.members[0];
  });

  // 4. 通知在线 admin（首次建联）
  this.eventEmitter.emit(
    CHAT_EVENTS.SUPPORT_CONVERSATION_STARTED,
    new SupportConversationStartedEvent(member.conversationId, businessId, userId),
  );

  return member;
}
```

### 4.6 创建渠道的事务逻辑

Admin 后台创建新渠道时，后端使用事务保证一致性：

```typescript
async createChannel(dto: CreateSupportChannelDto) {
  return this.prisma.$transaction(async (tx) => {
    // 1. 创建虚拟 bot User
    const botUser = await tx.user.create({
      data: {
        nickname: dto.name,                      // "Tech Support"
        avatar:   dto.avatar ?? '',
        phone:    `sys:bot:${Date.now()}`,        // 唯一占位
        phoneMd5: md5(`sys:bot:${Date.now()}`),
        isRobot:  true,
        status:   1,
      },
    });

    // 2. 创建渠道记录，botUserId 指向刚创建的 bot User
    return tx.supportChannel.create({
      data: {
        name:        dto.name,
        description: dto.description,
        botUserId:   botUser.id,
        isActive:    true,
      },
    });
  });
}
```

### 4.7 Admin UI 设计

```
┌─────────────────────────────────────────────────────────────────┐
│  Support Channels                               [+ New Channel] │
├──────────────────┬──────────────────┬──────────┬───────────────┤
│ Name             │ Description      │ Status   │ Actions       │
├──────────────────┼──────────────────┼──────────┼───────────────┤
│ Lucky Support    │ General help     │ ● Active │ Edit / Pause  │
│ Tech Support     │ Technical issues │ ● Active │ Edit / Pause  │
│ VIP Concierge    │ VIP members only │ ○ Paused │ Edit / Resume │
└──────────────────┴──────────────────┴──────────┴───────────────┘
```

- **Create**：填写英文名称、头像 URL、描述，后端事务内自动创建 bot User
- **Edit**：修改名称/头像，后端同步更新 `SupportChannel` + `User.nickname/avatar`
- **Pause / Resume**：切换 `isActive`，暂停后 Flutter 调用该 businessId 返回 404
- **无 Delete 按钮**：保护历史消息外键约束，只软停用

### 4.8 Flutter 侧：零改动

```
# Admin 后台新建渠道后立即生效，无需部署
GET /api/v1/chat/business?businessId=official_platform_support_v1  # 已有渠道
GET /api/v1/chat/business?businessId=tech_support_v1                # 新建渠道
GET /api/v1/chat/business?businessId=vip_support_v1                 # 新建渠道
```

后端从 `SupportChannel` 表动态查找，`businessId` 彻底脱离代码魔法字符串。

---

## 5. 完整效果对比

| 场景 | 当前（群聊）❌ | 修复后（1v1）✅ |
|---|---|---|
| 用户 A 和 B 同时客服 | 都在同一个群，互相能看消息 | 各自独立会话，完全隔离 |
| Admin 看客户列表 | 查询类型错误，看不到 | `type: SUPPORT`，一秒看全部 |
| 用户发消息 | Admin 30s 后靠轮询才知道 | Socket 实时通知，0 延迟 |
| Admin 回复 | `senderId=null`，FCM 推送失效 | `senderId=bot`，通知正常 |
| 离线 Admin 登录 | 没有消息历史 | 自动同步全部聊天记录 |
| AI 未来接入 | 需要重写代码 | 无缝替换，用户无感知 |

---

## 6. 改动清单：Phase 2 的 10 个手术点

| # | 改动点 | 当前 → 目标 |
|---|---|---|
| 1 | `schema.prisma` | 新增 SupportChannel 模型（含 botUserId FK） |
| 2 | `prisma migrate dev` | 生成并应用迁移文件 |
| 3 | `admin/support-channel` 模块 | 新增 GET / POST / PATCH / toggle CRUD |
| 4 | `chat.service.ts: addMemberToBusinessGroup` | BUSINESS 共享群聊 → SUPPORT per-user 1v1 |
| 5 | `chat.service.ts: searchUsers` | 新增 `isRobot: false` 条件，屏蔽 bot 被搜到 |
| 6 | `admin-chat.module.ts` | 导入 ChatModule，注入 ChatService |
| 7 | `admin-chat.service.ts: replyToConversation` | `senderId:null` → `chatService.sendMessage(botId, dto)` |
| 8 | `admin-chat.service.ts: getConversations` | 默认 type: BUSINESS → type: SUPPORT |
| 9 | `CustomerServiceDesk.tsx` | type: 'BUSINESS'（Phase 1 临时）→ type: 'SUPPORT' |
| 10 | `socket.listener.ts: handleMessageCreated` | 删除 BUSINESS 特判逻辑，走标准分发 |

---

## 7. 注意事项

| 要点 | 说明 |
|---|---|
| 英文名 | `nickname` 与 `conv.name` 均写英文，Flutter 两处显示统一 |
| 防搜索 | `searchUsers` 加 `isRobot: false`，一行覆盖现在及未来所有 bot 账号 |
| 消息 ID | `chatService.sendMessage` 需要唯一 UUID，`admin-chat.service` 已有 `uuidv4()` |
| Bot 成员检查 | 建联时虚拟账号已加入为 ChatMember，`sendMessage` 内部正常执行 |
| FCM 自推过滤 | `NotificationService` 过滤 `senderId === memberId`，bot 不会给自己推通知 |
| 审计追责 | `meta.realAdminId` 记录实际操作的 Admin ID，KPI 统计和追责依赖此字段 |
| 数据迁移 | 存量共享群会话无需强制迁移，老用户下次开启客服时自动获得新的 1v1 会话 |

---

## 8. 面试要点

### Q：为什么选择 Virtual Agent 模式而不是直接改 BUSINESS 类型的 @unique 约束？

因为 Virtual Agent 模式有三个优势：
1. **Schema 无需 migrate**：User 表已有 `isRobot` 字段，无需改现有会话表
2. **FCM 推送自动修复**：`senderId` 是真实 user ID（bot），走标准通知链路
3. **AI Agent 就绪**：未来接入 AI 时，AI 以 bot 身份发消息，Admin 端和用户端都零改动

### Q：Admin 回复时为什么要带 `meta.realAdminId`？

三个目的：
- **审计追责**：知道谁在什么时间回复了什么内容
- **KPI 统计**：计算每个 Admin 的回复量和响应时间
- **AI 训练数据**：标注哪些回复是人工写的，哪些可能是 AI 建议

### Q：POST /admin/support-channels 为什么用事务？

创建渠道需要同时创建 `User`（bot 账号）和 `SupportChannel`（渠道记录）。如果创建 User 成功但渠道记录失败，就会出现「孤儿 bot 账号」。事务保证这两个操作要么同时成功，要么同时回滚。

---

## 9. 总结

这个 IM 客服系统的重构历程展示了实时通信架构从「能用」到「好用」的演进路径：

1. **先修 Bug**：Phase 1 用最小的改动（新增事件、修正查询类型）让实时分发正常工作
2. **再改架构**：Phase 2 通过 Virtual Agent 模式，将群聊改造为真正的 1v1 私聊
3. **预留扩展**：SupportChannel 表的设计让运营侧可以自助管理客服渠道，无需开发介入
4. **面向未来**：bot 代发模式为 AI Agent 接入铺平了道路

---

*参考文件：`apps/api/src/common/chat/chat.service.ts`、`apps/api/src/common/events/listeners/socket.listener.ts`、`apps/admin-next/src/views/CustomerServiceDesk.tsx`*
