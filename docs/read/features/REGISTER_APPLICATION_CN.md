# Admin 注册申请功能设计文档

> 创建日期: 2026-03-17  
> 状态: ✅ 全部完成（2026-03-17）

---

## 一、功能概述

允许外部人员向 JoyMini Admin 后台提交账号申请，必须经过**超级管理员手动审批**才能获得访问权限。审批通过后账号默认为只读权限（`VIEWER`）。

---

## 二、注册方式决策

| 方式                | 结论                                           |
| ------------------- | ---------------------------------------------- |
| 手机短信 OTP        | ❌ 有成本，内部低频场景不值得                  |
| Google/GitHub OAuth | ❌ 适合直接登录，不适合"申请→等审批"中间状态   |
| **邮箱 + 密码**     | ✅ **选用** — 简单直接，邮箱仅用于接收审批通知 |

**为什么邮箱不需要 OTP 验证码：**  
超级管理员的手动审批本身就是人肉验证，比 OTP 更严格。邮件唯一作用是接收"审批通过/拒绝"通知。

---

## 三、多重防御体系

```
申请请求
   │
   ├─ L1 Google reCAPTCHA v3      ← 前端获取 token，后端验证分数 ≥ 0.5
   ├─ L2 IP 频率限制               ← Redis: 同 IP 每 24h 最多 3 次申请
   ├─ L3 Throttler 限流            ← @nestjs/throttler: 5次/15分钟/IP
   ├─ L4 邮箱域名黑名单            ← 拒绝一次性邮箱（mailinator、guerrillamail 等 30+ 域名）
   ├─ L5 用户名冲突检查             ← 同时检查 AdminUser 表 + 待审批申请表
   └─ L6 邮箱重复检查              ← 同一邮箱只能有一条 pending 记录
```

### 各层详情

| 层级            | 技术实现                                                     | 参数                              |
| --------------- | ------------------------------------------------------------ | --------------------------------- |
| L1 reCAPTCHA v3 | `RecaptchaService` → Google API                              | score ≥ 0.5，action=`admin_apply` |
| L2 IP 日限      | `RedisService` key=`apply:ip:{ip}`                           | 3次/24h，滑动窗口                 |
| L3 接口限流     | `@Throttle`                                                  | 5次/15min/IP                      |
| L4 域名黑名单   | 硬编码 Set，30+ 一次性邮箱域名                               | 可随时扩充                        |
| L5 用户名冲突   | `prisma.adminUser.findUnique` + `findFirst(pending)`         | 双重检查                          |
| L6 邮箱去重     | `prisma.adminRegisterApplication.findFirst(pending + email)` | 防重复申请                        |

---

## 四、数据库模型

```prisma
model AdminRegisterApplication {
  id            String    @id @default(cuid()) @map("app_id")
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  // 申请人信息
  username      String    // 期望的用户名
  password      String    // bcrypt 加密存储
  realName      String    // 真实姓名
  email         String    // 用于接收通知
  applyReason   String?   // 申请理由
  applyIp       String?   // 申请时 IP（安全审计用）

  // 审批结果
  status        String    @default("pending")  // pending | approved | rejected
  reviewedBy    String?   // 审批管理员 ID
  reviewNote    String?   // 拒绝原因
  reviewedAt    DateTime?

  @@map("admin_register_applications")
}
```

**状态流转：**

```
pending ──→ approved  →  自动创建 AdminUser(role=VIEWER, status=1)
        └─→ rejected  →  记录拒绝原因，发邮件通知
```

---

## 五、API 接口

| Method  | Path                                | Guard                | 说明                     |
| ------- | ----------------------------------- | -------------------- | ------------------------ |
| `POST`  | `/auth/admin/apply`                 | ❌ 公开              | 提交注册申请             |
| `GET`   | `/admin/applications`               | ✅ JWT               | 申请列表（分页+过滤）    |
| `GET`   | `/admin/applications/pending-count` | ✅ JWT               | 待审批数量（侧边栏红点） |
| `PATCH` | `/admin/applications/:id/approve`   | ✅ JWT (SUPER_ADMIN) | 审批通过                 |
| `PATCH` | `/admin/applications/:id/reject`    | ✅ JWT (SUPER_ADMIN) | 审批拒绝                 |

### 申请接口请求体

```typescript
{
  username: string;       // 3-50字符，只允许字母/数字/下划线
  password: string;       // 最少8位，必须包含字母和数字
  realName: string;       // 真实姓名
  email: string;          // 有效邮箱（非一次性域名）
  applyReason?: string;   // 申请理由（选填，最多500字）
  recaptchaToken: string; // Google reCAPTCHA v3 token（必填）
}
```

---

## 六、邮件通知（Resend）

| 场景         | 邮件主题                                                | 接收方               |
| ------------ | ------------------------------------------------------- | -------------------- |
| 申请提交成功 | `[JoyMini Admin] Application Received — Pending Review` | 申请人               |
| 审批通过     | `[JoyMini Admin] Application Approved — Welcome!`       | 申请人               |
| 审批拒绝     | `[JoyMini Admin] Application Update`                    | 申请人（含拒绝原因） |

**邮件服务**: [Resend](https://resend.com) — 免费 3000封/月，100封/天  
**MVP 阶段**: `RESEND_API_KEY` 不配置时静默跳过，不影响核心流程

---

## 七、默认权限：VIEWER（最小权限原则）

审批通过时后端**写死** `role = 'VIEWER'`，不允许申请人自选角色。

```typescript
// VIEWER 权限范围（rbac.config.ts）
[Role.VIEWER]: [
  'user_management:view_user',    // 只读
  'order_management:view_order',  // 只读
  'marketing_management:view',    // 只读
]
// 没有任何 create / update / delete / ban 权限
```

超管审批后可在"用户管理"随时升级角色：`VIEWER → EDITOR / ADMIN / FINANCE`

---

## 八、新增环境变量

```dotenv
# Email (Resend)
RESEND_API_KEY=re_xxxxx              # 不填则邮件发送静默跳过
EMAIL_FROM=JoyMini Admin <noreply@joyminis.com>

# Google reCAPTCHA v3
RECAPTCHA_SECRET_KEY=6Le...          # 不填或填 "disabled" 则跳过验证
NEXT_PUBLIC_RECAPTCHA_SITE_KEY=6Le... # 前端用
```

---

## 九、前端页面

| 路径                                             | 类型                            | 组件                |
| ------------------------------------------------ | ------------------------------- | ------------------- |
| `/register-apply`                                | **Public**（middleware 白名单） | `RegisterApply.tsx` |
| `/users/applications` 或 AdminUserManagement Tab | **Protected** (SUPER_ADMIN)     | `ApplicationsList`  |

### 申请表单字段

```
✅ username       — 必填，实时格式校验
✅ password       — 必填，强度提示
✅ confirmPassword — 必填，两次密码一致校验
✅ realName       — 必填
✅ email          — 必填，格式校验
✅ applyReason    — 选填，textarea
✅ reCAPTCHA v3   — 不可见，自动执行
```

### 审批列表（AdminUserManagement 新增 Tab）

```
Tab: 待审批(n) / 已通过 / 已拒绝

列: 申请人 | 姓名 | 邮箱 | 申请时间 | 申请IP | 理由 | 操作
操作: [通过] [拒绝（弹窗填写原因）]
侧边栏: "用户管理" 菜单旁显示 pending-count 红点
```

---

## 十、实现进度

### 后端

- [x] `prisma/schema.prisma` — 新增 `AdminRegisterApplication` 模型
- [x] `prisma migrate dev --name add_register_application` — 迁移已执行
- [x] `src/common/email/email.service.ts` — Resend 邮件服务（含3种邮件模板）
- [x] `src/common/email/email.module.ts` — Global 模块
- [x] `src/common/recaptcha/recaptcha.service.ts` — reCAPTCHA v3 验证（score≥0.5）
- [x] `src/common/recaptcha/recaptcha.module.ts` — Global 模块
- [x] `src/admin/register-application/dto/create-application.dto.ts`
- [x] `src/admin/register-application/dto/review-application.dto.ts`
- [x] `src/admin/register-application/dto/list-application.dto.ts`
- [x] `src/admin/register-application/register-application.service.ts` — 核心逻辑（含6层防御）
- [x] `src/admin/register-application/register-application.controller.ts` — 公开+受保护双控制器
- [x] `src/admin/register-application/register-application.module.ts`
- [x] `src/admin/admin.module.ts` — 引入 RegisterApplicationModule
- [x] `src/app.module.ts` — 引入 EmailModule + RecaptchaModule
- [x] `deploy/.env.example` — 新增 RESEND_API_KEY / EMAIL_FROM / RECAPTCHA_SECRET_KEY

### 前端

- [x] `src/app/register-apply/page.tsx` — 公开申请页（含 GoogleReCaptchaProvider）
- [x] `src/views/RegisterApply.tsx` — 表单视图（含 reCAPTCHA v3）
- [x] `src/middleware.ts` — PUBLIC_PATHS 加 `/register-apply`
- [x] `src/type/types.ts` — 新增 AdminApplication / CreateApplicationPayload / ApplicationListParams
- [x] `src/api/index.ts` — 新增 applicationApi（submit/getList/pendingCount/approve/reject）
- [x] `src/views/Login.tsx` — 添加 "Apply for access" 链接
- [x] `src/views/AdminUserManagement.tsx` — 新增"Applications"Tab + pending count badge
- [x] `src/views/admin/ApplicationsManagement.tsx` — 审批列表（approve/reject/分页）
- [x] `src/components/layout/Sidebar.tsx` — /users 菜单项显示 pending 红点（60s 轮询）
