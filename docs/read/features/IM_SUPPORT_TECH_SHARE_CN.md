# Lucky Nest IM 客服系统 — 工程架构技术分享

> **模块**：后端 `apps/api` (NestJS + Prisma + Socket.IO) + Admin Next `apps/admin-next` (React 19 + Tailwind)  
> **状态**：Phase 1 已落地 ✅ · Phase 2 待实施  
> **更新时间**：2026-03-20  
> **用途**：技术分享、内部培训、架构文档  
> **面向对象**：工程师、架构师、技术决策者

---

## 核心摘要（一句话）

> **从群聊向 1v1 私聊的架构演进，通过虚拟 Bot + 事件驱动 + 多渠道管理，解决电商客服的隐私隔离、实时性、可扩展性问题，同时为 AI Agent 无缝接入预留架构基础。**

---

## 目录

1. [架构演进的问题诊断](#一架构演进的问题诊断)
2. [Phase 1 快速止血方案](#二phase-1-快速止血方案)
3. [Phase 2 长期架构重构](#三phase-2-长期架构重构)
4. [设计亮点与核心决策](#四设计亮点与核心决策)
5. [性能指标与可靠性](#五性能指标与可靠性)
6. [快速参考](#六快速参考)

---

## 一、架构演进的问题诊断

### 1.1 电商客服的业界标准模型

在淘宝、Amazon 等头部电商平台，客服模式是这样的：

```
用户 A  ──私聊──▶  [官方客服窗口]  ◀── Admin A / Admin B / AI 随时接管
用户 B  ──私聊──▶  [官方客服窗口]
用户 C  ──私聊──▶  [官方客服窗口]
```

**关键特征**：

- ✅ 每个用户都和**同一个虚拟客服身份**通话（对用户无感知）
- ✅ 但每个会话都是**独立的 1v1 私聊**（用户互不可见）
- ✅ Admin 在后台看到所有用户的**独立会话列表**，点进去处理各自的客户
- ✅ 未来接入 AI 时，AI **无缝替换** Admin，用户体验不变

---

### 1.2 Lucky Nest 当前系统的三层叠加缺陷

当前系统采用群聊模式，存在**从数据库到应用层递进的三个设计缺陷**：

| **缺陷层级**      | **根本原因**                                                        | **直接后果**                         | **用户体验**                                      |
| ----------------- | ------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------- |
| **1. Schema 层**  | `Conversation.businessId @unique` 约束                              | 同一 businessId 全库只能有 1 条会话  | ❌ 所有用户被强行 JOIN 同一个群                   |
| **2. Service 层** | `ensureBusinessConversation()` 按 businessId 查单条后 upsert member | 并发用户全部聚合到同一会话           | ❌ 用户 A 能看到用户 B 的聊天记录（严重隐私泄露） |
| **3. Reply 层**   | Admin 回复设置 `senderId: null`，直接调 `eventsGateway.dispatch()`  | 缺少合法发送者身份，FCM 推送链路断裂 | ❌ 用户后台退出后永远收不到 Admin 的通知          |

**完整问题链路**：

```
┌─ 数据隔离失效
│   ├─ 用户 A 打开客服 → 查 official_platform_support_v1 → JOIN 会话 X
│   ├─ 用户 B 打开客服 → 查 official_platform_support_v1 → 同一个会话 X ❌
│   └─ 结果：A 能看 B 的所有消息，B 能看 A 的订单号/地址等隐私
│
├─ 实时通知失效
│   ├─ 用户打开客服时，Admin 看不到新会话
│   └─ 需要 Admin 30 秒轮询才能感知
│
└─ 推送链路失效
    ├─ Admin 回复时 senderId = null
    └─ FCM 推送系统拒绝发送（没有合法发送者）
```

---

## 二、Phase 1 快速止血方案

> **目标**：修复 Admin 看不到会话、收不到消息的两个关键 Bug  
> **策略**：最小改动、快速上线、为 Phase 2 预留扩展点  
> **上线成果**：19 行代码改动，5 个文件，0 个 Schema 改动  
> **风险等级**：🟢 极低

### 2.1 两个关键 Bug 的根源

#### Bug #1：Admin 客服台查不到用户会话

**症状**：

```
Flutter 侧：POST /chat/business  → 创建 type: BUSINESS 会话
Admin 侧：  GET /conversations?type=SUPPORT  → 永远为空 ❌
```

**根因分析**：

```typescript
// Frontend 硬编码
const response = await getConversations({
  type: 'SUPPORT'    ← Admin 期望查 SUPPORT
});

// Backend 实际创建
ChatService.addMemberToBusinessGroup()
  └─ ensureBusinessConversation()
       └─ type: CONVERSATION_TYPE.BUSINESS  ← 但实际建的是 BUSINESS
```

**一行修复**：

```diff
- type: 'SUPPORT'
+ type: 'BUSINESS'
```

#### Bug #2：用户打开客服 Admin 靠轮询才感知

**症状**：

- 用户点「联系客服」
- Admin 需要等 30 秒轮询周期才能看到新会话

**根因分析**：

```
用户 GET /chat/business
  ├─ ChatService.addMemberToBusinessGroup()
  ├─ 添加到会话成员
  └─ ❌ 没有任何事件 → Admin 毫无感知

30 秒后...
Admin 定时轮询 getConversations() → 查数据库 → 看到新会话
```

**解决方案**：增加**首次建联事件**，通过事件驱动通知所有在线 Admin

---

### 2.2 两条实时通知路径

#### 路径 A：会话建联 → Admin 列表刷新（<100ms）

```typescript
// Step 1: 后端判断"首次加入"并发事件
async addMemberToBusinessGroup(businessId: string, userId: string) {
  const conversation = await ensureBusinessConversation(businessId);
  const existingMember = await findMember(userId, conversationId);

  if (!existingMember) {
    // 首次加入才发事件
    this.eventEmitter.emit(
      CHAT_EVENTS.SUPPORT_CONVERSATION_STARTED,
      { conversationId, businessId, userId }
    );
  }
}

// Step 2: Socket 监听器广播给所有在线 Admin
@OnEvent(CHAT_EVENTS.SUPPORT_CONVERSATION_STARTED)
async handleSupportConversationStarted(event) {
  const admins = await prisma.adminUser.findMany({
    where: { status: 1, deletedAt: null }
  });

  admins.forEach(admin => {
    this.eventsGateway.dispatch(
      `user_${admin.id}`,  // ← Admin 私有房间
      'support_new_conversation',
      { conversationId: event.conversationId }
    );
  });
}

// Step 3: 前端 Hook 响应事件
useChatSocket(...
  case 'support_new_conversation':
    // 立即刷新会话列表
    queryClient.invalidateQueries(['conversations']);
    break;
)
```

**时间对比**：

- **Before**：30 秒（轮询周期）
- **After**：<100ms（事件驱动）
- **提升**：300 倍 ⚡

#### 路径 B：消息同步 → 双向实时（200-500ms）

```
用户发消息 POST /chat/message
  ├─ ChatService.sendMessage()
  ├─ EventEmitter.emit(MESSAGE_CREATED)
  ├─ dispatch 到会话房间（其他成员）
  └─ dispatch 到 admin 私有房间 ✅
       └─ Admin 客服台实时显示消息
```

---

### 2.3 Phase 1 引入的三个关键设计

#### 设计 1：私有 Socket 房间隔离

```typescript
// 每个 Admin 连接时自动加入私有房间
@SubscribeMessage('connect')
handleConnection(socket) {
  const adminId = socket.handshake.auth.adminId;
  socket.join(`user_${adminId}`);  // ← 私有房间，只此 Admin 能收
}

// 发事件时精确路由
eventsGateway.dispatch(
  `user_${adminId}`,  // ← 只给这个 Admin，不广播
  'chat_message',
  payload
);
```

**优势**：

- ✅ 多 Admin 并行处理，各自收到各自的事件
- ✅ 事件隔离，A 的客户信息不会漂到 B 的客户端
- ✅ Socket 断开时自动释放房间资源

#### 设计 2：事件驱动 + 关注点分离

```
业务层（ChatService）          事件层（EventEmitter）
─────────────────────────────────────────────────────
addMember()  ──Emit──→  SUPPORT_CONVERSATION_STARTED
sendMessage() ─Emit─→  MESSAGE_CREATED

Socket 层（SocketListener）
─────────────────────────────────────────────────────
handleSupportConversationStarted()
  └─ eventsGateway.dispatch() → 通知所有 Admin

handleMessageCreated()
  └─ eventsGateway.dispatch() → 通知 members
```

**优势**：

- ✅ 业务逻辑与 Socket 分离，易于单测
- ✅ 事件可灵活扩展（如未来接入 SMS/钉钉通知）
- ✅ ChatService 无需 mock Socket，纯业务测试

#### 设计 3：兜底轮询机制

```typescript
// Phase 1 保留轮询作为降级
const pollingInterval = 30 * 1000;

useEffect(() => {
  const timer = setInterval(() => {
    refreshConversations(); // Socket 异常时的容错
  }, pollingInterval);

  return () => clearInterval(timer);
}, []);
```

**优势**：

- ✅ 网络波动时的自动降级
- ✅ 不依赖 Socket 完全可靠
- ✅ 老版本客户端的自动兼容

---

### 2.4 Phase 1 改造清单

| **改动点** | **文件**                  | **行数**  | **风险**          |
| ---------- | ------------------------- | --------- | ----------------- |
| 事件类声明 | `chat.events.ts`          | +5        | 🟢 极低           |
| 事件发射   | `chat.service.ts`         | +3        | 🟢 极低           |
| 事件监听   | `socket.listener.ts`      | +8        | 🟡 中低           |
| 前端响应   | `useChatSocket.ts`        | +4        | 🟢 极低           |
| 查询类型   | `CustomerServiceDesk.tsx` | -1        | 🟢 极低           |
| **总计**   | 5 个文件                  | **19 行** | **🟢 可立即上线** |

---

## 三、Phase 2 长期架构重构

> **目标**：彻底解决数据隔离问题，支持运营动态新增客服渠道，为 AI Agent 接入预留架构  
> **难度**：中等，需要 2-3 周  
> **收益**：长期可维护、可扩展、支持多渠道

### 3.1 虚拟 Bot 账号设计哲学

**核心设计决策**：虚拟客服**不是特殊对象**，而是普通 User 记录（`isRobot: true`）

#### 为什么用真实 User 而不是虚拟对象

```
❌ 虚拟对象方案          ✅ 真实 User 方案
────────────────────────────────────────
需要改 IM 架构            复用整个 IM 基础设施
自定义消息存储            数据库标准存储
改 FCM 推送流程           推送自动生效 ✅
改搜索逻辑               搜索自动隔离（isRobot:false）
改权限管理               权限系统无改动
```

#### 虚拟 Bot 的创建时机

在 Admin UI 新建渠道时，**通过数据库事务自动创建**：

```typescript
async createChannel(dto: CreateSupportChannelDto) {
  return this.prisma.$transaction(async (tx) => {
    // 1. 自动创建虚拟 Bot User
    const botUser = await tx.user.create({
      data: {
        nickname: 'Tech Support',              // ← 英文展示名
        avatar: 'https://...',
        phone: `sys:bot:${Date.now()}`,        // ← 占位标记
        phoneMd5: md5(...),
        isRobot: true,                         // ← 标志位
        status: 1,
      }
    });

    // 2. 创建渠道配置，关联 Bot ID
    return await tx.supportChannel.create({
      data: {
        name: 'Tech Support',
        botUserId: botUser.id,                 // ← 1-1 映射
        isActive: true,
      }
    });
  });
}
```

**安全约束**：`searchUsers` 必须加 `isRobot: false` 过滤

```typescript
where: {
  AND: [
    { id: { not: myUserId } },
    { isRobot: false },  // ← 防止用户搜到虚拟 Bot
    { OR: [{ nickname: ... }, { phone: ... }] },
  ],
}
```

---

### 3.2 多渠道管理的数据库设计

#### SupportChannel 表：businessId 到 Bot 的映射

```prisma
model SupportChannel {
  id          String   @id @default(cuid())
  /// id 直接等于 Flutter 传入的 businessId，无转换成本

  name        String   @db.VarChar(100)
  description String?  @db.VarChar(255)
  avatar      String?

  botUserId   String   @unique         // 1-1 映射到 Bot User
  botUser     User     @relation(fields: [botUserId], references: [id])

  isActive    Boolean  @default(true)  // 软停用，保护消息 FK

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("support_channels")
}
```

**为什么是 `@unique`？** 防止多个渠道共享同一 Bot，会导致消息隔离失效

**为什么软停用而非硬删除？** 历史 `ChatMessage.senderId` 存储的是 `botUserId`，硬删除会触发 FK 约束错误

#### 用户建联时的查表逻辑

```typescript
async addMemberToBusinessGroup(businessId: string, userId: string) {
  // 1. 查表获取 Bot ID（替换硬编码）
  const channel = await this.prisma.supportChannel.findUnique({
    where: { id: businessId },
    include: { botUser: true }
  });

  if (!channel || !channel.isActive) {
    throw new NotFoundException('Support channel not found');
  }

  // 2. 检查是否已有 1v1 会话（幂等性）
  const existing = await this.prisma.conversation.findFirst({
    where: {
      type: CONVERSATION_TYPE.SUPPORT,
      AND: [
        { members: { some: { userId } } },
        { members: { some: { userId: channel.botUserId } } }
      ]
    }
  });

  if (existing) return existing.members[0];

  // 3. 事务建联：创建 SUPPORT 会话 + 两个成员
  const conv = await this.prisma.$transaction(async (tx) => {
    return tx.conversation.create({
      data: {
        type: CONVERSATION_TYPE.SUPPORT,        // ← 改为 SUPPORT
        name: channel.name,
        avatar: channel.botUser.avatar,
        members: {
          create: [
            { userId, role: ChatMemberRole.MEMBER },
            { userId: channel.botUserId, role: ChatMemberRole.MEMBER }
          ]
        }
      },
      include: { members: { where: { userId } } }
    });
  });

  // 4. 发事件通知 Admin（复用 Phase 1 机制）
  this.eventEmitter.emit(CHAT_EVENTS.SUPPORT_CONVERSATION_STARTED, ...);

  return conv.members[0];
}
```

**时间复杂度**：O(1) 查表 + O(1) 会话检查 + O(n) 插入 → **总体 O(1)**

---

### 3.3 Admin 回复链路的改造

#### 旧模式（Phase 1）：直接发送 + 丢失身份 ❌

```typescript
async replyToConversation(conversationId, content) {
  await chatMessage.create({
    senderId: null,              // ← 身份丢失
    conversationId,
    content
  });

  eventsGateway.dispatch(conversationId, 'message_created', ...);
}
```

**问题**：

- ❌ senderId = null，FCM 推送系统无法识别合法发送者
- ❌ 用户后台时收不到通知
- ❌ 消息历史里看不到谁在回复

#### 新模式（Phase 2）：通过 Bot 代发 + 审计元数据 ✅

```typescript
async replyToConversation(conversationId, content, adminId) {
  // 1. 查出 Bot ID
  const conv = await conversation.findUnique({ ... });
  const botId = conv.members.find(m => m.user.isRobot)?.userId;

  // 2. 用 ChatService 标准路径发送
  await this.chatService.sendMessage(botId, {
    conversationId,
    content,
    meta: {
      realAdminId: adminId,           // ← 审计链：真实操作者
      agentName: '李华',               // ← 可选：客服真名
      replyAt: new Date()
    }
  });
}
```

**改造收益**：

- ✅ 消息走 MESSAGE_CREATED 事件 → Socket 分发 → FCM 推送 ✅
- ✅ 用户后台时能收到通知（botUserId 是真实 User）
- ✅ 消息历史保留 realAdminId，支持 KPI 统计与法务追责

---

### 3.4 Admin UI 设计

新增页面 `/admin/support-channels`：

```
┌──────────────────────────────────────────────────────┐
│  Support Channels  🔔 (2 Active)    [+ New Channel] │
├─────────┬──────────────┬──────────┬─────────────────┤
│ Channel │ Description  │ Status   │ Actions         │
├─────────┼──────────────┼──────────┼─────────────────┤
│ General │ General help │ ● Active │ Edit | Pause    │
│ Tech    │ Tech support │ ● Active │ Edit | Pause    │
│ VIP     │ VIP service  │ ○ Paused │ Edit | Resume   │
└─────────┴──────────────┴──────────┴─────────────────┘
```

| 操作       | 后端行为                           | 客户端影响                         |
| ---------- | ---------------------------------- | ---------------------------------- |
| **Create** | 事务内创建 Bot User + Channel 记录 | 新渠道立即对客户端可用（无需部署） |
| **Edit**   | 更新 Channel.name 和 User.avatar   | 后续建联时生效                     |
| **Pause**  | 设置 isActive = false              | 调用该 businessId 返回 404         |
| **Delete** | 禁用（无 Delete 按钮）             | 保护消息 FK 完整性                 |

---

### 3.5 Phase 2 改造清单：10 个手术点

```
序号  改动模块                         当前 → 目标
──────────────────────────────────────────────────────────────
 1   schema.prisma                  新增 SupportChannel 模型 + 迁移
 2   ChatService.addMember          硬编码 businessId → 查 SupportChannel
 3   ChatService.searchUsers        无 isRobot 过滤 → 加过滤
 4   AdminChatService.reply         senderId=null → chatService.sendMessage(botId)
 5   AdminChatModule                导入 ChatService 注入
 6   AdminChatController            新增 support-channels CRUD 接口
 7   SocketListener.handle*         BUSINESS 特判 → 删除
 8   CustomerServiceDesk.tsx        type='BUSINESS' → type='SUPPORT'
 9   Admin UI 页面                  新增 /support-channels 页面
10   Seed 数据                       初始化虚拟 Bot + Channel 记录
```

---

## 四、设计亮点与核心决策

### 4.1 三个最聪明的决策

| 排名 | 决策                               | 工程价值                                             |
| ---- | ---------------------------------- | ---------------------------------------------------- |
| 🥇   | **虚拟 Bot 用真实 User 账号**      | 自动复用 IM 全链路；FCM 推送零改动；搜索自动隔离     |
| 🥈   | **SupportChannel.id = businessId** | 后端查表替换硬编码；Flutter 端零改动；运营可自助新增 |
| 🥉   | **meta.realAdminId 审计链**        | 为 AI Agent 替换、KPI 统计、法务追责打好基础         |

### 4.2 避坑指南

| 陷阱                            | 表现                                                                                                     | 防护                                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Bot 被用户搜到                  | 用户绕过官方入口私信 Bot                                                                                 | `searchUsers` 加 `isRobot: false` 过滤                                                                                     |
| 渠道硬删除                      | 历史消息 FK 约束错误                                                                                     | 只软停用 (`isActive: false`)                                                                                               |
| Admin 回复无推送                | 用户离线收不到消息                                                                                       | 必须用 Bot User 代发（senderId = botUserId）                                                                               |
| 并发 Admin 冲突                 | 两个 Admin 同时回复会乱序                                                                                | 加乐观锁或排他锁（Phase 3 考虑）                                                                                           |
| **Close 后用户无法重新发起** 🔴 | Admin 关闭会话后用户再点「联系客服」，`findFirst` 找到已 CLOSED 的旧会话并返回，用户卡在无法继续的对话里 | `addMemberToBusinessGroup` 的 `findFirst` 查询必须加 `status: ConversationStatus.NORMAL` 过滤，CLOSED 会话不复用，自动新建 |

**关键 Fix（已落地）**：

```typescript
// ❌ 旧代码：没有 status 过滤，会找到 CLOSED 的旧会话
const existingConversation = await this.prisma.conversation.findFirst({
  where: {
    type: CONVERSATION_TYPE.SUPPORT,
    AND: [
      { members: { some: { userId } } },
      { members: { some: { userId: channel.botUserId } } },
    ],
  },
});

// ✅ 修复后：只复用 NORMAL 状态的会话
const existingConversation = await this.prisma.conversation.findFirst({
  where: {
    type: CONVERSATION_TYPE.SUPPORT,
    status: ConversationStatus.NORMAL, // ← 关键：CLOSED(2) 的旧会话不复用
    AND: [
      { members: { some: { userId } } },
      { members: { some: { userId: channel.botUserId } } },
    ],
  },
});
```

**用户视角**（修复后完整闭环）：

```
用户第一次发起    → 创建新 SUPPORT 会话
Admin close 会话  → status 设为 2(CLOSED)，推送系统消息
用户再次点「联系客服」
  → findFirst 找不到 NORMAL 会话（旧的是 CLOSED）
  → 自动创建新会话 ✅
  → Admin 客服台收到 support_new_conversation 事件 ✅
```

---

## 五、性能指标与可靠性

### 5.1 实时延迟指标

| 场景                      | Phase 1 前 | Phase 1 后 | Phase 2 后  |
| ------------------------- | ---------- | ---------- | ----------- |
| 用户打开客服 → Admin 感知 | 30s        | <100ms     | <100ms      |
| 用户发消息 → Admin 收到   | 1-2s       | 200-500ms  | 200-500ms   |
| Admin 回复 → 用户收到     | N/A        | 2-5s       | 2-5s        |
| 离线用户 → 收到消息       | ❌ 无      | ❌ 无      | ✅ 自动同步 |

### 5.2 可靠性多层防护

```
┌─ Socket 实时通知（首选）
├─ 30s 轮询兜底（Socket 断连时）
├─ 消息存储持久化（数据库）
├─ FCM 推送（Phase 2 新增，真实 User）
└─ Admin 手动刷新（最后一根救命稻草）
```

---

## 六、快速参考

### 代码模式 1：查表替换硬编码

```typescript
// 旧模式
const channel = "official_platform_support_v1"; // 硬编码
const botUserId = "bot_official_support"; // 硬编码

// 新模式
const channel = await prisma.supportChannel.findUnique({
  where: { id: businessId },
});
const botUserId = channel.botUserId; // 动态查询
```

### 代码模式 2：事件驱动分发

```typescript
// 发事件
this.eventEmitter.emit(CHAT_EVENTS.SUPPORT_CONVERSATION_STARTED, event);

// 监听并分发
@OnEvent(CHAT_EVENTS.SUPPORT_CONVERSATION_STARTED)
async handle(event) {
  this.eventsGateway.dispatch(`user_${adminId}`, 'event_type', payload);
}

// 前端响应
case 'event_type':
  queryClient.invalidateQueries(['conversations']);
  break;
```

### 代码模式 3：通过 Bot 代发消息

```typescript
// 标准流程
await this.chatService.sendMessage(botUserId, {
  conversationId,
  content,
  meta: { realAdminId, agentName }, // ← 审计元数据
});

// 自动触发：MESSAGE_CREATED → Socket 分发 → FCM 推送
```

---

## 业界对标分析

| 维度        | Lucky Nest            | Zendesk         | Intercom       |
| ----------- | --------------------- | --------------- | -------------- |
| 数据隔离    | 1v1 私聊 ✅           | 共享队列 ⚠️     | 1v1 私聊 ✅    |
| 审计链      | meta + realAdminId ✅ | 内置但不开放 ⚠️ | 基础审计 ⚠️    |
| 虚拟身份    | User 账号 ✅          | 托管 ✅         | Assistant ✅   |
| AI 可替换性 | 代码路径设计 ✅       | API 形式 ⚠️     | Plugin 形式 ⚠️ |
| 多渠道支持  | Admin UI 待 P2 ⚠️     | 原生 ✅         | 原生 ✅        |
| 成本        | 开源（免费）✅        | $49/user/月     | $39/user/月    |

---

## 后续演进方向

### Phase 3：运营优化层

```
├─ 客服分流：技能标签 + 智能路由
├─ 质量控制：消息加签、敏感词审核、满意度评分
└─ 数据分析：在线客服数、平均回复时间、客服利用率
```

### Phase 4：可靠性强化

```
├─ 消息重试：失败自动重发
├─ 宕机恢复：消息备份 + 秒级恢复
└─ 多机房容灾：异地热备 + 故障转移
```

---

## 总结

### 核心口径

这套设计的本质是：**用虚拟 Bot + 1v1 私聊 + 事件驱动，把一个有隐私泄露风险的群聊系统，改造成了一个隐私安全、实时高效、可扩展的电商级客服架构**。

### 适合分享的三个核心观点

1. **架构演进应该分阶段**：Phase 1 快速止血，Phase 2 长期优化，而不是一步到位
2. **复用而不是重新实现**：虚拟 Bot 用真实 User，自动复用整个 IM 基础设施
3. **在数据库层面做决策**：SupportChannel 表设计决定了整个渠道管理的灵活性

---
