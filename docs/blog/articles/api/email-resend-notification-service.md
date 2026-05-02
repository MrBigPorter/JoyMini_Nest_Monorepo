# 邮件通知服务：管理员申请流程的 Resend 集成

**Date:** 2026-05-01  
**Tags:** `NestJS` `Email` `Resend` `Notification` `Admin` `Application` `Authentication` `TypeScript`  
**Code Reference:** [`email.service.ts`](apps/api/src/common/email/email.service.ts)

---

## 目录

1. [架构概览](#1-架构概览)
2. [服务设计 — 精简专注](#2-服务设计--精简专注)
3. [邮件模板](#3-邮件模板)
4. [优雅降级](#4-优雅降级)
5. [对比：邮件服务与其他通知渠道](#5-对比邮件服务与其他通知渠道)
6. [关键要点](#6-关键要点)

---

## 1. 架构概览

邮件通知服务是一个**专注、单一用途的模块**，仅处理管理员申请流程邮件和客户端登录验证码：

```
┌──────────────────────┐
│  申请模块             │
│  (提交/批准/拒绝)     │
└──────────┬───────────┘
           │ 调用
           ▼
┌──────────────────────┐
│   EmailService       │
│   (Resend SDK)       │
│                       │
│  ┌─────────────────┐ │
│  │ sendApplication │ │
│  │ Received()      │ │
│  ├─────────────────┤ │
│  │ sendApplication │ │
│  │ Approved()      │ │
│  ├─────────────────┤ │
│  │ sendApplication │ │
│  │ Rejected()      │ │
│  ├─────────────────┤ │
│  │ sendClientLogin │ │
│  │ Code()          │ │
│  └─────────────────┘ │
└──────────────────────┘
```

## 2. 服务设计 — 精简专注

### 2.1 初始化

```typescript
@Injectable()
export class EmailService {
  private resend: Resend | null = null;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    this.from = this.config.get<string>('EMAIL_FROM') ?? 'JoyMini Admin <noreply@joyminis.com>';
    this.frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'https://admin.joyminis.com';

    if (apiKey && apiKey !== 'disabled') {
      this.resend = new Resend(apiKey);
      this.logger.log('邮件服务已初始化（Resend）');
    } else {
      this.logger.warn('RESEND_API_KEY 未设置 — 邮件发送功能已禁用');
    }
  }
}
```

**关键设计决策：**
- **`resend: Resend | null`** — 服务无需 SDK 初始化即可正常工作。缺少 API 密钥 → 优雅禁用，而非崩溃。
- **`apiKey !== 'disabled'`** — 允许通过配置明确禁用，而无需删除环境变量
- **`from` 和 `frontendUrl`** — 默认值确保服务在无配置的开发环境中也能正常工作

### 2.2 私有发送方法

所有公共方法都委托给一个私有 `send()` 方法：

```typescript
private async send(opts: { to: string; subject: string; html: string }) {
  if (!this.resend) {
    this.logger.debug(`[邮件跳过] 收件人: ${opts.to} | 主题: ${opts.subject}`);
    return;
  }
  try {
    const { error } = await this.resend.emails.send({
      from: this.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    if (error) {
      this.logger.error(`邮件发送失败: ${JSON.stringify(error)}`);
    } else {
      this.logger.log(`邮件已发送至 ${opts.to} — ${opts.subject}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error(`邮件服务错误: ${message}`);
  }
}
```

**错误处理理念：** 所有错误都被捕获并记录，从不抛出。邮件发送永远不会破坏主要业务流程（申请提交、登录）。如果邮件发送失败，应用程序本身仍然正常工作——只是管理员没有收到通知。

---

## 3. 邮件模板

### 3.1 申请已收到

当用户提交管理员申请时发送：

```html
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
  <h2 style="color:#4f46e5">申请已收到 🎉</h2>
  <p>我们已收到您加入 <strong>JoyMini Admin</strong> 的申请。</p>
  <p>您的请求目前正在等待超级管理员的<strong>审核</strong>。</p>
</div>
```

### 3.2 申请已批准

当超级管理员批准申请时发送，包含登录链接：

```html
<h2 style="color:#16a34a">申请已批准 🎉</h2>
<p>好消息！您的申请已<strong>通过</strong>。</p>
<table>
  <tr><td>用户名</td><td>${username}</td></tr>
  <tr><td>默认角色</td><td>查看者（只读）</td></tr>
</table>
<a href="${loginUrl}" style="display:inline-block;padding:10px 20px;background:#4f46e5;color:#fff;">
  登录 →
</a>
```

### 3.3 申请被拒绝

当申请未通过时发送，可选包含审核人备注：

```html
<h2 style="color:#dc2626">申请未通过</h2>
<p>很遗憾，您的申请目前<strong>未获批准</strong>。</p>
${reviewNote ? `<p><strong>原因：</strong> ${reviewNote}</p>` : ''}
```

### 3.4 客户端登录验证码

发送给使用邮箱验证登录的客户端用户：

```html
<h2 style="color:#2563eb">登录验证码</h2>
<p>请使用以下验证码登录：</p>
<div style="font-size:28px;letter-spacing:4px;font-weight:700;margin:16px 0;">
  ${code}
</div>
<p>此验证码在 <strong>${ttlMinutes} 分钟</strong>内有效。</p>
<p style="color:#dc2626">请勿将此验证码分享给任何人。</p>
```

---

## 4. 优雅降级

邮件服务遵循**故障开放**理念：

| 场景 | 行为 | 影响 |
|----------|----------|--------|
| 无 API 密钥 | 记录警告，跳过发送 | 无邮件，应用正常工作 |
| `disabled` 配置 | 明确跳过 | 无邮件，应用正常工作 |
| Resend API 错误 | 记录错误，继续执行 | 丢失一封邮件，应用正常工作 |
| 网络故障 | 记录错误，继续执行 | 临时邮件丢失，应用正常工作 |

这是恰当的，因为：
1. 邮件是**异步通知**，而非同步验证
2. 即使通知失败，管理员申请仍然会被创建
3. 管理员可以在仪表盘中手动查看申请状态

---

## 5. 对比：邮件服务与其他通知渠道

| 特性 | 邮件（Resend） | Socket.IO（EventsGateway） | FCM 推送 |
|---------|---------------|--------------------------|----------|
| **投递方式** | 尽力而为（SMTP） | 即时（在线时） | 设备相关 |
| **用例** | 管理员工作流、登录验证码 | 实时聊天、通话信令 | 离线通知 |
| **重试** | 无（即发即忘） | 不适用（实时） | 队列 + 重试 |
| **模板** | 内联 HTML 字符串 | 结构化 JSON 负载 | 纯数据消息 |
| **成本** | 免费套餐（Resend：100/天） | 包含（WebSocket） | 免费（Firebase） |
| **降级** | 故障开放（记录错误） | 故障关闭（无连接） | 故障开放（回退到 SMS） |

---

## 6. 关键要点

1. **专注的范围** — `EmailService` 仅为两个工作流处理 4 种邮件类型：管理员申请生命周期和客户端登录验证码。不含新闻通讯、营销或密码重置邮件。

2. **Resend SDK** — 现代邮件 API，具有高投递率（98%+ 收件箱到达率），取代了传统的 SMTP 配置。

3. **故障开放设计** — 邮件故障永远不会破坏主要业务流程。日志记录是发送失败的唯一后果。

4. **内联 HTML 模板** — 无模板引擎依赖。所有模板都是服务内的内联 HTML 字符串，保持模块自包含并避免模板注入漏洞。

5. **全方位可配置** — API 密钥、发件人地址和前端 URL 均可通过环境变量配置，并带有适用于开发的合理默认值。
