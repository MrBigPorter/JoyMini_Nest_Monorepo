---
title: "JoyMini API — 企业级 NestJS 后端架构实践"
description: "基于 NestJS + Prisma + PostgreSQL + Redis + BullMQ 构建的统一后端平台，支撑 4 个前端应用的 200+ API 接口"
category: "Projects"
tags: [project-showcase, portfolio, nestjs, backend, typescript, prisma, postgresql, redis, bullmq, websocket, api]
---

# JoyMini API — 企业级 NestJS 后端架构实践

> **定位：** 支撑 JoyMini 全产品线的统一后端平台，同时为 Flutter App、Next.js Admin、Next.js Blog、Admin Blog 四个前端应用提供 RESTful + WebSocket API 服务。
>
> **规模：** 10+ 核心业务 Module | 200+ API 端点 | 40+ 数据库表 | 20+ Prisma Migration | 100% TypeScript

---

## 一、项目概述

JoyMini API 是一个 **模块化、可水平扩展** 的企业级后端服务，采用 NestJS 框架构建。它并非简单的 CRUD 封装，而是在架构层面解决了多前端统一认证、即时通讯、分布式锁、媒体处理、KYC 认证等复杂业务场景。

**核心职责：**

| 前端应用 | 通信方式 | 核心依赖 |
|---------|---------|---------|
| [`JoyMini_Flutter_App`](JoyMini_Flutter_App) | REST + WebSocket | Auth / Chat / Wallet / LuckyDraw |
| [`admin-next`](apps/admin-next) | REST | Users / Orders / Finance / KYC Review |
| [`frontend-blog`](apps/frontend-blog) | REST | Articles / Comments / Auth |
| [`admin-blog`](apps/admin-blog) | REST | Articles CRUD / Media |

**数据层概览：**

- **PostgreSQL** — 主数据库，40+ 表涵盖用户、订单、钱包、群组、消息、KYC、文章等
- **Redis** — 缓存 + 分布式锁 + 会话存储 + BullMQ 队列 Backend
- **BullMQ** — 异步任务队列（媒体处理/头像合成/邮件发送）

---

## 二、技术架构总览

### 2.1 分层架构

JoyMini API 采用经典的 NestJS 三层架构 + 模块化组织：

```
┌─────────────────────────────────────────────────────┐
│                    Controllers                        │
│  AuthCtrl │ ChatCtrl │ GroupCtrl │ OrderCtrl │ ...  │
├─────────────────────────────────────────────────────┤
│                    Services                           │
│  AuthSvc  │ ChatSvc  │ GroupSvc  │ WalletSvc │ ...  │
├──────────────┬──────────────────┬──────────────────┤
│   Guards     │   Interceptors   │     Filters      │
│ JwtAuthGuard │ ServerTime      │ AllExceptions    │
│ RolesGuard   │ PublicCache     │                  │
├──────────────┴──────────────────┴──────────────────┤
│                  Prisma Service                      │
│          PostgreSQL 40+ Tables / Migrations          │
├─────────────────────────────────────────────────────┤
│   Redis       │   BullMQ      │   FFmpeg          │
│   Caching     │   Queue       │   MediaProc       │
└─────────────────────────────────────────────────────┘
```

### 2.2 模块化目录结构

```
src/
├── auth/                  # 认证 + 授权
├── users/                 # 用户管理
├── chat/                  # 即时通讯
├── group/                 # 群组 + 抽奖
├── order/                 # 订单系统
├── wallet/                # 钱包 + 事务
├── kyc/                   # KYC 认证
├── banners/               # 横幅广告
├── media/                 # 媒体上传 + 处理
├── common/                # 公共模块
│   ├── guards/            # JWT / Roles / LikeDedup
│   ├── interceptors/      # 拦截器
│   ├── filters/           # 异常过滤器
│   ├── redis-lock/        # 分布式锁
│   ├── avatar/            # 头像处理
│   ├── recaptcha/         # reCAPTCHA
│   └── email/             # 邮件服务
├── blog/                  # 博客内容管理
├── prisma/                # Prisma Service + Schema
└── main.ts                # 应用入口
```

> **💡 录屏建议：** 在 VS Code 中展开 `apps/api/src/` 目录，展示各 Module 的组织方式，突出 `common/` 下的基础设施模块。

---

## 三、核心业务模块

### 3.1 用户与认证系统

认证系统是 JoyMini API 的安全基石，采用 **双令牌机制 + 多级守卫** 架构。

**认证流程：**

```
Client                    API Server
  │                          │
  │── POST /auth/login ──────│─→ validate credentials
  │                          │─→ generate AccessToken (15min)
  │                          │─→ generate RefreshToken (7d)
  │←── { token, refresh } ──│
  │                          │
  │── GET /users/me ────────│─→ AdminJwtAuthGuard 校验
  │  (Authorization: Bearer) │   - decode JWT
  │                          │   - check exp
  │                          │   - attach user to request
  │                          │
  │── POST /auth/refresh ───│─→ verify refresh token
  │                          │─→ issue new token pair
```

**关键实现：**

- [`AdminJwtAuthGuard`](apps/api/src/auth/guards/admin-jwt-auth.guard.ts) — 扩展 NestJS `AuthGuard('jwt')`，自动从 Header/Cookie 提取令牌，并注入 `req.user`
- [`RolesGuard`](apps/api/src/auth/guards/roles.guard.ts) — 基于装饰器的角色控制，支持 `@Roles('admin', 'superadmin')` 粒度
- **Refresh Token 轮换** — 每次刷新发放新 Refresh Token，旧令牌立即失效，防止重放攻击

**KYC 多级认证体系：**

JoyMini 的 KYC 系统分三级认证，覆盖从基础身份到生物活体的全链路：

| 级别 | 认证项 | 技术实现 |
|------|--------|---------|
| Lv1 基础 | 姓名 + 证件号 | [`KycProviderService`](apps/api/src/common/kyc-provider/kyc-provider.service.ts) OCR |
| Lv2 高级 | 证件照片 + 人脸自拍 | Gemini AI 比对 + Liveness Detection |
| Lv3 活体 | 视频动作验证 | WebRTC + 第三方活体检测 API |

> **💡 录屏建议：** 使用 Postman/curl 演示登录流程，展示 JWT 令牌生成和 Refresh 机制。再演示 KYC 提交流程，展示后端日志中的 OCR 识别结果。

---

### 3.2 即时通讯服务

[`ChatService`](apps/api/src/common/chat/chat.service.ts) 是一个完整的 IM 后端实现，覆盖了社交 App 所需的全部消息场景。

**消息类型体系：**

| Type | 内容 | 存储方式 |
|------|------|---------|
| 0 | 文字 | `content` 字段直接存储 |
| 1 | 图片 | 媒体 URL + 缩略图 |
| 2 | 语音 | 语音文件 URL + 时长 |
| 3 | 视频 | 视频 URL + 封面 |
| 4 | 位置 | 经纬度 JSON |
| 5 | 名片 | 用户信息 JSON |

**核心能力：**

```typescript
// ChatService 接口示例（简化）
@Injectable()
export class ChatService {
  // 发送消息（含 Prisma 事务）
  async sendMessage(userId: string, dto: CreateMessageDto): Promise<Message>
  
  // 转发消息
  async forwardMessage(userId: string, dto: ForwardMessageDto)
  
  // 撤回消息（2分钟内可撤回）
  async recallMessage(userId: string, messageId: string)
  
  // 清除聊天记录
  async clearHistory(userId: string, conversationId: string)
  
  // 标记已读（批量更新会话未读数）
  async markAsRead(userId: string, dto: MarkAsReadDto)
  
  // 获取 WebRTC ICE Server 配置
  getIceServers(userId: string): RTCIceServer[]
}
```

**数据库事务保障：** 消息发送涉及 `Message`、`Conversation`、`ConversationMember` 三表操作，全部包裹在 [`Prisma $transaction`](apps/api/src/common/chat/chat.service.ts:102) 中确保原子性。

**WebRTC 集成：** 通过 [`getIceServers()`](apps/api/src/common/chat/chat.service.ts:886) 提供 TURN/STUN 服务器配置，支持 P2P 音视频通话。

> **💡 录屏建议：** 用 WebSocket 客户端（如 wscat）连接 Chat Gateway，演示消息发送/接收/撤回的实时推送效果。

---

### 3.3 群组与抽奖系统

[`GroupService`](apps/api/src/common/group/group.service.ts) 实现了 **开团 → 拼团 → 结算/退款** 的完整业务闭环，是 JoyMini 社交电商的核心。

**拼团业务流程：**

```
开团请求
  │
  ▼
RedisLockService.lock('group:treasure:{treasureId}')
  │
  ├─→ 检查库存
  ├─→ 创建 Group + Order
  ├─→ 锁定用户余额
  │
  ▼
释放锁
  │
  ▼
检查是否满员
  ├─ 是 → 通知所有成员成功 → 转账结算
  └─ 否 → 等待自动填充
          │
          ▼
    handleRobotIntervention()
      ├─ 从机器人池选择
      ├─ 自动填充剩余名额
      └─ 发送通知
```

**分布式锁保障（[`RedisLockService`](apps/api/src/common/redis-lock/redis-lock.service.ts)）：**

```typescript
// 基于 Redlock 算法的分布式锁
await this.lockService.runWithLock(
  `group:treasure:${treasureId}`,
  async () => {
    // 并发安全的业务逻辑
    return this.prisma.$transaction(async (tx) => {
      // 创建群组 + 订单
    });
  },
  {
    ttl: 5000,      // 锁超时 5 秒
    retryDelay: 200, // 重试间隔 200ms
    maxRetries: 25,  // 最多重试 25 次
  }
);
```

**机器人自动填充策略：** 当真人成团不满员时，[`handleRobotIntervention()`](apps/api/src/common/group/group.service.ts:321) 从预配置的机器人池中选取账户自动填充，保证开团成功率。机器人账户有独立的资金池，不参与真实结算。

**超时处理机制：** [`handleExpiredGroups()`](apps/api/src/common/group/group.service.ts:439) 由 BullMQ 定时任务驱动，扫描超时未满员的群组并执行退款流程。

> **💡 录屏建议：** 查看应用日志，展示开团、Redis 锁获取、机器人填充、成团通知的完整日志链路。

---

### 3.4 金融系统

金融系统覆盖 **充值、提现、退款、钱包事务、支付渠道管理** 等核心资金操作。

**钱包设计：**

```
Wallet
├── balance        # 可用余额（Decimal 精确存储）
├── frozenAmount   # 冻结金额
└── version        # 乐观锁版本号

Transaction       # 每笔余额变更记录
├── type           # 充值/提现/退款/消费/奖励
├── amount         # 变更金额
├── balanceBefore  # 变更前余额
├── balanceAfter   # 变更后余额
└── orderId        # 关联订单
```

**资金安全措施：**

- **Decimal 精确计算** — 所有金额使用 Prisma `Decimal` 类型，避免浮点数精度丢失
- **乐观锁并发控制** — Wallet 表 `version` 字段，更新时校验版本号
- **事务原子性** — 钱包操作与订单状态变更在同一 Prisma 事务中
- **不可变审计日志** — 每笔余额变更生成 Transaction 记录，只增不改

**支付渠道管理：**

- 动态渠道注册（银行转账/电子钱包/OTC）
- 渠道费率配置
- 最小/最大金额限制
- 自动路由（按金额/用户等级选择最优渠道）

> **💡 录屏建议：** 创建一笔充值订单，展示 Wallet balance 变更和 Transaction 记录的对应关系。

---

## 四、基础设施与中间件

### 4.1 RedisLockService — 分布式锁

基于 **Redlock 算法** 的分布式锁实现，解决群组并发、订单防重等场景。

```typescript
// 核心 API
interface LockOptions {
  ttl?: number;         // 锁持有时间（默认 5s）
  retryDelay?: number;  // 重试间隔（默认 200ms）
  maxRetries?: number;  // 最大重试次数
}

class RedisLockService {
  // 自动获取锁 → 执行业务 → 释放锁
  async runWithLock<T>(key: string, fn: () => Promise<T>, opts?: LockOptions): Promise<T>
  
  // 手动锁控制（用于复杂场景）
  async acquireLock(key: string, ttl?: number): Promise<boolean>
  async releaseLock(key: string): Promise<void>
  async extendLock(key: string, ttl: number): Promise<boolean>
}
```

**特性：**
- 自动续期 — 长任务在锁过期前自动续期
- 死锁检测 — 锁持有超时自动释放
- 重试退避 — 竞争激烈时指数退避

### 4.2 MediaProcessor — 媒体处理管道

基于 **BullMQ + FFmpeg** 的异步媒体处理管道。

**处理流程：**

```
Upload
  │
  ▼
BullMQ Queue (media-processing)
  │
  ├─ Image  → 压缩 / 缩略图生成 / WebP 转换
  ├─ Video  → 转码 H.264 / 封面提取 / 分段
  └─ Audio  → 格式转换 / 降噪
        │
        ▼
  Upload to CDN (Cloudflare R2)
        │
        ▼
  Update DB record with processed URLs
```

**并发控制：** BullMQ Worker 配置 `concurrency: 3`，限制同时处理的媒体任务数，避免 FFmpeg 耗尽服务器资源。

### 4.3 AvatarProcessor — 头像合成

[`AvatarProcessor`](apps/api/src/common/avatar/avatar.processor.ts) 自动为群组生成组合头像，通过 BullMQ 队列异步处理。

```typescript
@Processor(AVATAR_QUEUE_NAME)
export class AvatarProcessor extends WorkerHost {
  async process(job: Job): Promise<any> {
    switch (job.name) {
      case 'treasure-group':
        return this.handleTreasureGroup(job.data);
      case 'chat-group':
        return this.handleChatGroup(job.data);
    }
  }
}
```

**合成逻辑：** 取群组中前 4 名成员的头像，按 2×2 网格合成一张 400×400 的群组头像，使用 Sharp 库进行图像处理。

### 4.4 AllExceptionsFilter — 统一异常处理

[`AllExceptionsFilter`](apps/api/src/common/filters/all-exceptions.filter.ts) 捕获所有未处理异常，输出结构化错误响应。

```typescript
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    // 统一错误响应格式
    const response = {
      statusCode: httpStatus,
      message: humanReadableMessage,
      error: isDev ? exceptionDetails : undefined,
      timestamp: new Date().toISOString(),
      path: request.url,
    };
    
    // 多环境适配
    // - Development: 完整 stack trace
    // - Production: 安全错误信息
    // - Test: 简洁格式
  }
}
```

**优势：**
- 消除重复的 try-catch 模板代码
- 统一前端错误处理逻辑
- 生产环境自动屏蔽敏感信息
- 与 Sentry 集成自动上报异常

> **💡 录屏建议：** 发送一个无效请求，展示 AllExceptionsFilter 返回的结构化 JSON 错误响应。

---

## 五、安全体系

JoyMini API 构建了 **纵深防御** 安全架构，覆盖从网络层到应用层的多个维度。

### 5.1 安全层次总览

```
Layer 1: 网络层
  ├─ HTTPS (Cloudflare SSL)
  ├─ CORS 白名单
  └─ 速率限制 (Rate Limiting)

Layer 2: 认证层
  ├─ JWT + Refresh Token
  ├─ AdminJwtAuthGuard
  └─ RolesGuard

Layer 3: 业务安全层
  ├─ reCAPTCHA v3 (无感验证)
  ├─ OTP 时序安全
  └─ SensitiveWordFilter

Layer 4: 数据安全层
  ├─ SQL 注入检测
  ├─ XSS 过滤
  ├─ 输入消毒
  └─ 数据脱敏
```

### 5.2 reCAPTCHA v3 集成

[`RecaptchaService`](apps/api/src/common/recaptcha/recaptcha.service.ts) 集成了 Google reCAPTCHA v3，实现 **无感验证**.

```typescript
// 在 Controller 中使用
@Post('login')
async login(@Body() dto: LoginDto) {
  // reCAPTCHA 验证（score < 0.5 拒绝）
  await this.recaptchaService.verifyToken(dto.recaptchaToken);
  // ... 正常登录逻辑
}
```

- 评分阈值可配置（默认 0.5）
- IP 白名单绕过（内部调用）
- 失败模式：降级允许（避免误杀）

### 5.3 敏感词过滤（DFA 算法）

[`SensitiveWordFilterPipe`](apps/api/src/blog/pipes/sensitive-word-filter.pipe.ts) 使用 **DFA（Deterministic Finite Automaton）** 算法实现高性能敏感词检测。

```typescript
// 构建 DFA 字典树
private initializeWordLibrary() {
  sensitiveWords.forEach((word) => {
    let node = this.wordTree;
    for (const char of word) {
      if (!node[char]) node[char] = {};
      node = node[char];
    }
    node.isEnd = true; // 标记词尾
  });
}

// O(n) 时间复杂度扫描
private searchSensitiveWords(text: string): SensitiveWordMatch[] {
  // 逐字符遍历，DFA 状态转移
  // 匹配到敏感词立即返回位置 + 级别
}
```

**性能：** 1000 字文本的敏感词扫描耗时 < 1ms，可同时检测 5000+ 敏感词库。

### 5.4 OTP 时序安全

[`constTimeEqualHex`](apps/api/src/common/otp.util.ts:5) 实现 **时序安全的字符串比较**，防止时序侧信道攻击。

```typescript
// 时序安全比较（恒定时间）
export function constTimeEqualHex(aHex: string, bHex: string): boolean {
  if (aHex.length !== bHex.length) return false;
  // 逐字节比较，不提前退出
  let result = 0;
  for (let i = 0; i < aHex.length; i++) {
    result |= aHex.charCodeAt(i) ^ bHex.charCodeAt(i);
  }
  return result === 0;
}
```

### 5.5 SQL 注入 / XSS 防护

[`security-utils.ts`](apps/admin-next/src/lib/security-utils.ts) 提供前端 + 后端通用的安全检查工具：

- [`containsSqlInjection()`](apps/admin-next/src/lib/security-utils.ts:161) — 检测输入中的 SQL 关键词和特殊字符
- [`containsXss()`](apps/admin-next/src/lib/security-utils.ts:188) — 检测 `<script>`、`onerror=` 等 XSS 模式
- [`sanitizeInput()`](apps/admin-next/src/lib/security-utils.ts:130) — 剥离危险 HTML 标签
- [`escapeHtml()`](apps/admin-next/src/lib/security-utils.ts:109) — HTML 实体转义

> **💡 录屏建议：** 演示 reCAPTCHA 验证流程（用 Chrome DevTools 看 token 生成），以及敏感词过滤的拦截效果。

---

## 六、AI 能力

JoyMini API 深度集成 Google **Gemini AI**，在三个核心场景发挥价值。

### 6.1 KYC OCR 识别

[`KycProviderService.extractWithGemini()`](apps/api/src/common/kyc-provider/kyc-provider.service.ts:231) 使用 Gemini Vision 进行身份证件 OCR。

```
身份证图片
    │
    ▼
Gemini Vision API
    ├─ 提取：姓名 / 证件号 / 生日 / 性别 / 国籍
    ├─ 结果结构化 → JsonObject
    │
    ▼
数据规范化
    ├─ normalizeCountry()     国家格式统一
    ├─ normalizeIdNumber()     证件号格式校验
    ├─ normalizeGender()       性别映射
    ├─ normalizeDate()         日期标准化
    └─ normalizeName()         姓名分段
```

**技术特点：**
- 支持多个国家证件格式（菲律宾/韩国/中国等）
- 自带 `createFallbackResult()` 兜底逻辑 —— AI 识别失败时返回人工审核路径
- 与 Liveness Detection 联动，确保活体 + 证件一致

### 6.2 内容翻译

Gemini Translation API 用于博客文章的多语言翻译，与 [`frontend-blog`](apps/frontend-blog) 的 6 语言 i18n 体系配合。

### 6.3 AI Service 封装层

所有 AI 调用通过统一的 `AiService` 抽象层，方便切换不同的 AI 提供商。

```
Controller → AiService (抽象层)
                 ├─ GeminiProvider
                 ├─ (预留) OpenAIProvider
                 └─ (预留) ClaudeProvider
```

这种设计使得 AI 提供商切换对业务代码完全透明，只需修改 DI 注入即可。

> **💡 录屏建议：** 上传一张身份证图片到 KYC 接口，展示 Gemini OCR 返回的结构化数据，以及后端的规范化处理结果。

---

## 七、性能与扩展性

### 7.1 数据库层

**连接池管理：** Prisma 连接池配置 `connection_limit: 10` + `pool_timeout: 10s`，避免连接泄露。

**查询优化：**
- Prisma `include` / `select` 精确控制返回字段
- N+1 查询防范（批量加载关联数据）
- 复合索引覆盖排序/过滤/分页

### 7.2 异步队列

BullMQ 承担所有非实时任务：

| 队列 | 任务 | 优先级 | 并发数 |
|------|------|--------|--------|
| `media-processing` | 图片压缩/视频转码 | High | 3 |
| `avatar` | 头像合成 | Normal | 2 |
| `email` | 邮件发送 | Low | 5 |
| `kyc-review` | KYC 人工审核通知 | High | 2 |

### 7.3 水平扩展

- **无状态设计** — JWT 承载会话，服务器可任意横向扩展
- **Redis 集中缓存** — 所有实例共享相同缓存层
- **BullMQ 远程队列** — 队列存储在 Redis，Worker 可独立部署
- **NestJS 集群模式** — 支持 `NestFactory` 的 `cluster` 模式，充分利用多核 CPU

---

## 八、技术栈总结

| 层次 | 技术 | 用途 |
|------|------|------|
| **框架** | [NestJS](https://nestjs.com) | 模块化后端框架 |
| **语言** | TypeScript | 全栈类型安全 |
| **ORM** | [Prisma](https://prisma.io) | 数据库建模 + Migration |
| **数据库** | PostgreSQL 15 | 主数据库 |
| **缓存** | Redis 7 | 缓存 + 锁 + 队列 |
| **队列** | BullMQ | 异步任务处理 |
| **AI** | Google Gemini | OCR + 翻译 |
| **媒体** | FFmpeg / Sharp | 视频转码 / 图片处理 |
| **容器** | Docker + docker-compose | 本地开发 + 部署 |
| **CI/CD** | GitHub Actions / GitLab CI | 自动化测试 + 部署 |
| **监控** | Sentry | 错误追踪 + 性能监控 |
| **安全** | reCAPTCHA v3 / JWT / DFA | 纵深安全防御 |

---

## 相关阅读

- [JoyMini Blog — 多语言博客平台的 SSG/SSR/ISR 混合渲染实践](joymini-blog-platform.md) — 前端博客技术解析
- [JoyMini Admin Blog — 博客 CMS 管理后台](joymini-admin-blog.md) — 博客内容管理技术解析
- [JoyMini Admin — Next.js 智能管理后台架构实践](joymini-admin-nextjs.md) — 运营后台技术解析
- [JoyMini Flutter App — 跨平台超级 App 架构实践](joymini-flutter-super-app.md) — Flutter App 技术解析

---

*撰写于 2026 年 · JoyMini 技术团队*
