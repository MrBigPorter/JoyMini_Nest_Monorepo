# 注册申请审批工作流 — 管理员账号自助申请到权限开通的全链路

## 1. 背景

在 [`JoyMini`](apps/admin-next) 管理后台中，新管理员账号的创建有两种途径：

1. **SUPER_ADMIN 手动创建** — 直接在「管理员管理」页面通过 [`CreateAdminUserModal`](apps/admin-next/src/components/admin-users/AdminUserManagementClient.tsx:472) 添加
2. **自助申请审批** — 用户通过公开注册页提交申请，经 SUPER_ADMIN 审核后自动开通账号

本文聚焦第二种途径：**注册申请审批工作流**。该流程允许外部用户（如新员工、合作伙伴运营人员）主动提交管理员账号申请，SUPER_ADMIN 在后台审核并批准/驳回，系统自动创建账号并通知申请人。

核心源码文件：
- **Service**: [`RegisterApplicationService`](apps/api/src/admin/register-application/register-application.service.ts:68)
- **Controller**: [`ApplyController` + `ApplicationsAdminController`](apps/api/src/admin/register-application/register-application.controller.ts:28)
- **前端申请页**: [`RegisterApply`](apps/admin-next/src/views/RegisterApply.tsx:84)
- **前端审批管理**: [`ApplicationsManagement`](apps/admin-next/src/views/admin/ApplicationsManagement.tsx:114)
- **Prisma 模型**: [`AdminRegisterApplication`](apps/api/prisma/schema.prisma:176)

---

## 2. 整体架构

```
┌─────────────────────────┐
│  公开申请页              │  POST /auth/admin/apply (public)
│  /register-apply         │  @Throttle 5/15min, @RealIp
│  [RegisterApply.tsx]     │  5 层安全守卫
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  RegisterApplicationSvc  │  create(dto, ip)
│  ① reCAPTCHA v3         │
│  ② IP 限流 (3/24h)      │
│  ③ 临时邮箱阻断          │
│  ④ 用户名冲突            │
│  ⑤ 重复待审批            │
│  创建记录 → Redis 计数    │
│  发送通知邮件（异步）      │
└────────┬────────────────┘
         │ status=pending
         ▼
┌─────────────────────────┐
│  管理员审批面板           │  SUPER_ADMIN only
│  ApplicationsManagement  │  4 个 Tab: 待审/已通过/已拒绝/全部
│  [ApplicationsMgmt.tsx]  │  Approve / Reject 按钮
└────────┬────────────────┘
         │
    ┌────┴────┐
    ▼         ▼
  Approve    Reject
  │          │
  │          ├─ 更新 status='rejected'
  │          ├─ 记录 reviewNote
  │          └─ 发送拒绝邮件
  │
  ├─ $transaction:
  │   ├─ AdminUser.create(role=VIEWER)
  │   └─ Application.update(status='approved')
  ├─ 检查用户名仍可用
  └─ 发送审批通过邮件
```

---

## 3. 数据库设计（Prisma）

### 3.1 [`AdminRegisterApplication`](apps/api/prisma/schema.prisma:176) — 注册申请表

```prisma
/// 管理员注册申请表（提交申请 → 超管审批 → 创建账号）
model AdminRegisterApplication {
  id            String    @id @default(cuid()) @map("app_id") @db.VarChar(32)
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")

  /// 申请人填写
  username      String    @map("username") @db.VarChar(50)
  password      String    @map("password") @db.VarChar(255)   // 已哈希
  realName      String    @map("real_name") @db.VarChar(100)
  email         String    @map("email") @db.VarChar(100)
  applyReason   String?   @map("apply_reason")
  /// 申请时 IP（用于安全审计）
  applyIp       String?   @map("apply_ip") @db.VarChar(50)

  /// 审批状态: pending | approved | rejected
  status        String    @default("pending") @map("status") @db.VarChar(20)

  /// 审批信息
  reviewedBy    String?   @map("reviewed_by") @db.VarChar(32)
  reviewNote    String?   @map("review_note")
  reviewedAt    DateTime? @map("reviewed_at")

  @@index([status], map: "idx_app_status")
  @@index([email], map: "idx_app_email")
  @@index([username], map: "idx_app_username")
  @@index([createdAt], map: "idx_app_created_at")
  @@map("admin_register_applications")
}
```

### 3.2 [`AdminUser`](apps/api/prisma/schema.prisma:156) — 审批通过后创建的管理员

```prisma
model AdminUser {
  id            String    @id @default(cuid()) @map("admin_id") @db.VarChar(32)
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")
  deletedAt     DateTime? @map("deleted_at")
  username      String    @unique @map("username") @db.VarChar(50)
  password      String    @map("password") @db.VarChar(255)
  realName      String?   @map("real_name") @db.VarChar(100)
  role          String    @default("viewer") @map("role") @db.VarChar(50)
  status        Int       @default(1) @map("status") @db.SmallInt
  // ...
}
```

### 3.3 数据流

申请提交时，密码已通过 [`PasswordService.hash()`](apps/api/src/admin/register-application/register-application.service.ts:121) 哈希后才存储。审批通过时，`$transaction` 原子性地创建 [`AdminUser`](apps/api/prisma/schema.prisma:156)（直接复用已哈希的密码）并更新申请表状态。这意味着申请表中的密码字段仅作为审批通过后的账号创建数据源，不会用于其他用途。

---

## 4. 五层安全守卫（申请提交）

[`RegisterApplicationService.create()`](apps/api/src/admin/register-application/register-application.service.ts:81) 构成了一个纵深防御体系，共有 5 层安全检查：

### L1: reCAPTCHA v3（人机验证）

```typescript
// L1: reCAPTCHA v3 验证
await this.recaptchaService.verify(dto.recaptchaToken, 'admin_apply');
```

前端通过 [`useGoogleReCaptcha`](apps/admin-next/src/views/RegisterApply.tsx:85) 获取 token，调用时传入 action `'admin_apply'`。Google 返回 0.0–1.0 的分数，低于阈值（通常在 0.5）将被拒绝。

### L2: IP 限流（Redis 计数器）

```typescript
const IP_LIMIT = 3;
const IP_WINDOW_SECONDS = 86_400; // 24 小时

private async checkIpRateLimit(ip: string) {
  const key = `apply:ip:${ip}`;
  const raw = await this.redisService.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= IP_LIMIT) {
    throw new ForbiddenException('...');
  }
}
```

每个 IP 地址 **24 小时内最多 3 次申请**。Redis key 使用自然滑动窗口——仅在首次设置时带 TTL，后续只递增不刷新过期时间：

```typescript
private async incrementIpCounter(ip: string) {
  const key = `apply:ip:${ip}`;
  const raw = await this.redisService.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count === 0) {
    await this.redisService.set(key, '1', IP_WINDOW_SECONDS); // 首次设 TTL
  } else {
    await this.redisService.set(key, String(count + 1), IP_WINDOW_SECONDS); // 递增
  }
}
```

这种设计确保了严格的 24 小时窗口：即使第 1 次和第 3 次申请间隔 23 小时，第 3 次仍然受限。

### L3: 临时邮箱阻断

```typescript
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'temp-mail.org',
  'yopmail.com', 'sharklasers.com', '10minutemail.com',
  // ... 共 38 个域名
]);

private validateEmailDomain(email: string) {
  const domain = email.split('@')[1]?.toLowerCase();
  if (DISPOSABLE_DOMAINS.has(domain)) {
    throw new BadRequestException('Disposable email addresses are not allowed...');
  }
}
```

38 个已知的临时邮箱域名被硬编码阻断，防止机器人使用一次性邮箱批量注册。

### L4: 用户名冲突检测

```typescript
const existingAdmin = await this.prisma.adminUser.findUnique({
  where: { username: dto.username },
  select: { id: true },
});
if (existingAdmin) {
  throw new ConflictException('Username is already taken');
}
```

检查 [`AdminUser`](apps/api/prisma/schema.prisma:156) 表中是否已存在相同用户名。由于 [`username` 字段有 `@unique`](apps/api/prisma/schema.prisma:161) 约束，这一步也可以在 DB 层面捕获冲突，但提前检查可以提供更友好的错误信息。

### L5: 重复待审批申请检测

```typescript
const duplicatePending =
  await this.prisma.adminRegisterApplication.findFirst({
    where: {
      status: 'pending',
      OR: [{ username: dto.username }, { email: dto.email }],
    },
  });
if (duplicatePending) { /* ... */ }
```

如果已有相同用户名**或**相同邮箱的申请处于 `pending` 状态，拒绝重复提交。这防止了同一个申请人提交多份申请。

### 额外防线：Throttle 全局限流

```typescript
@Throttle({ default: { limit: 5, ttl: 900_000 } }) // 15 分钟 5 次
async apply(@Body() dto: CreateApplicationDto, @RealIp() ip: string) {
  return this.svc.create(dto, ip);
}
```

控制器层面额外叠加了 [`@Throttle`](apps/api/src/admin/register-application/register-application.controller.ts:38) 装饰器（NestJS `@nestjs/throttler`），**15 分钟内最多 5 次请求**，作为倒数第二道防线。

---

## 5. 管理员审批面板（前端）

[`ApplicationsManagement`](apps/admin-next/src/views/admin/ApplicationsManagement.tsx:114) 是嵌入在 [`AdminUserManagementClient`](apps/admin-next/src/components/admin-users/AdminUserManagementClient.tsx:393) 中的审批面板，仅对 `SUPER_ADMIN` 可见。

### 5.1 Tab 切换

```typescript
const TABS = (t): { label: string; value: ApplicationStatus | 'all' }[] => [
  { label: 'Pending', value: 'pending' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
  { label: 'All', value: 'all' },
];
```

四个 Tab 对应 [`ListApplicationDto.status`](apps/api/src/admin/register-application/dto/list-application.dto.ts:23) 的四个枚举值。默认显示 `pending` 待审批列表。

### 5.2 待审批数量 Badge

```typescript
const { data: countData } = useRequest(
  () => applicationApi.pendingCount(),
  { refreshDeps: [] },
);
```

侧边栏和 Tab 上的红点 Badge 通过轮询 [`GET /admin/applications/pending-count`](apps/api/src/admin/register-application/register-application.controller.ts:61) 获取。API 响应仅为 `{ count: number }`，轻量高效：

```typescript
// API 客户端配置
pendingCount: () =>
  http.get<{ count: number }>(
    '/v1/admin/applications/pending-count',
    undefined,
    { trace: false, showError: false }, // 静默处理 403
  ),
```

注意 [`showError: false`](apps/admin-next/src/api/index.ts:933) 和 `trace: false` 的配置：非 SUPER_ADMIN 访问时返回 403，但不弹 Toast，也不上报到 Sentry。

### 5.3 申请列表

```typescript
const { data, loading, refresh } = useRequest(
  () => applicationApi.getList({ page, pageSize: 20, status: tab }),
  { refreshDeps: [tab, page] },
);
```

每个申请卡片展示：
- **申请人信息**: 姓名 + `@用户名` + 状态 Badge
- **联系方式**: 邮箱
- **申请理由**: 斜体引文（可选）
- **时间 & IP**: `createdAt` + `applyIp` 用于安全审计
- **审批备注**: `reviewNote`（仅已拒绝时显示）

### 5.4 审批操作

**批准** — 一键操作：

```typescript
const { run: runApprove } = useRequest(
  (id: string) => applicationApi.approve(id),
  {
    manual: true,
    onSuccess: (res) => {
      addToast('success', res.message);
      refresh();        // 刷新列表
      refreshCount();   // 刷新 Badge
      window.dispatchEvent(new Event('applications:pending-updated'));
    },
  },
);
```

**拒绝** — 弹出 [`RejectModal`](apps/admin-next/src/views/admin/ApplicationsManagement.tsx:16) 填写驳回原因：

```typescript
const { run: runReject } = useRequest(
  (id: string, note: string) => applicationApi.reject(id, note),
  { manual: true, onSuccess: () => { /* ... */ } },
);
```

拒绝弹窗的 textarea 最大 500 字符，与后端 [`ReviewApplicationDto.reviewNote`](apps/api/src/admin/register-application/dto/review-application.dto.ts:16) 的 `@MaxLength(500)` 对应。

---

## 6. 后端审批核心逻辑

### 6.1 [`approve()`](apps/api/src/admin/register-application/register-application.service.ts:209) — 批准

```typescript
async approve(id: string, reviewerId: string) {
  const app = await this.findPendingOrThrow(id);

  // 二次检查用户名是否仍可用（可能在申请到审批期间被手动创建）
  const conflict = await this.prisma.adminUser.findUnique({
    where: { username: app.username },
  });
  if (conflict) {
    throw new ConflictException(
      `Username "${app.username}" was taken after submission. Reject and re-apply.`,
    );
  }

  await this.prisma.$transaction(async (ctx: any) => {
    // 创建 AdminUser，角色为 VIEWER（最小权限）
    await ctx.adminUser.create({
      data: {
        username: app.username,
        password: app.password,       // 复用已哈希的密码
        realName: app.realName,
        role: Role.VIEWER,
        status: 1,
      },
    });

    // 标记申请为已批准
    await ctx.adminRegisterApplication.update({
      where: { id },
      data: { status: 'approved', reviewedBy: reviewerId, reviewedAt: new Date() },
    });
  });

  // 异步发送通知邮件
  this.emailService.sendApplicationApproved(app.email, app.realName, app.username)
    .catch((e) => this.logger.error(`Email failed: ${e}`));
}
```

**关键设计决策**：

1. **$transaction 保证原子性** — 创建管理员账号和更新申请状态在同一个 DB 事务中，不会出现账号创建成功但申请状态未更新的情况。

2. **VIEWER 最小权限** — 新创建的账号默认仅拥有 `VIEWER` 角色，SUPER_ADMIN 可根据需要提升权限。这符合最小权限原则。

3. **二次用户名检查** — 从申请提交到审批可能经过较长时间，期间其他 SUPER_ADMIN 可能已手动创建了同名账号。这个检查避免了 DB 唯一约束冲突。

4. **复用已哈希密码** — 申请时已哈希的密码直接传递给 [`AdminUser.create`](apps/api/src/admin/register-application/register-application.service.ts:226)，无需二次哈希。

### 6.2 [`reject()`](apps/api/src/admin/register-application/register-application.service.ts:262) — 拒绝

```typescript
async reject(id: string, dto: ReviewApplicationDto, reviewerId: string) {
  const app = await this.findPendingOrThrow(id);

  await this.prisma.adminRegisterApplication.update({
    where: { id },
    data: {
      status: 'rejected',
      reviewedBy: reviewerId,
      reviewNote: dto.reviewNote,
      reviewedAt: new Date(),
    },
  });

  this.emailService.sendApplicationRejected(app.email, app.realName, dto.reviewNote)
    .catch((e) => this.logger.error(`Email failed: ${e}`));
}
```

拒绝逻辑相对简单：更新状态、记录审批备注、发送通知邮件。注意拒绝**不需要**事务，因为只涉及单表更新。

### 6.3 [`findPendingOrThrow()`](apps/api/src/admin/register-application/register-application.service.ts:285) — 安全守卫

```typescript
private async findPendingOrThrow(id: string) {
  const app = await this.prisma.adminRegisterApplication.findUnique({
    where: { id },
  });
  if (!app) throw new NotFoundException('Application not found');
  if (app.status !== 'pending') {
    throw new BadRequestException(
      `Application is already "${app.status}" and cannot be reviewed again`,
    );
  }
  return app;
}
```

这个辅助方法被 `approve()` 和 `reject()` 共用，确保了：
- 申请必须存在（404）
- 申请必须处于 `pending` 状态（400）
- 已审批或已拒绝的申请不可重复操作

### 6.4 [`findAll()`](apps/api/src/admin/register-application/register-application.service.ts:152) — 列表查询

```typescript
async findAll(query: ListApplicationDto) {
  const { page = 1, pageSize = 20, status = 'pending', username } = query;

  const where: { status?: string; username?: { contains: string; mode: 'insensitive' } } = {};
  if (status && status !== 'all') where.status = status;
  if (username) where.username = { contains: username, mode: 'insensitive' };

  const [total, list] = await this.prisma.$transaction([
    this.prisma.adminRegisterApplication.count({ where }),
    this.prisma.adminRegisterApplication.findMany({
      where, skip, take: pageSize,
      orderBy: { createdAt: 'desc' },
      select: { /* 显式字段选择 */ },
    }),
  ]);

  return {
    total, page, pageSize,
    totalPages: Math.ceil(total / pageSize),
    list: list.map((item: any) => ({
      ...item,
      createdAt: item.createdAt.getTime(),           // Date → timestamp
      reviewedAt: item.reviewedAt?.getTime() ?? null,
    })),
  };
}
```

注意 `$transaction` 中的并行查询（`count` + `findMany`）——这保证了分页数据的一致性。时间戳转换为毫秒级 Unix timestamp 以便前端 JS 直接使用 `new Date(timestamp)`。

---

## 7. DTO 验证体系

前端和后端各自维护了一套验证逻辑，互为补充。

### 7.1 后端 DTO（class-validator）

[`CreateApplicationDto`](apps/api/src/admin/register-application/dto/create-application.dto.ts:12) 使用 `class-validator` 装饰器：

| 字段 | 规则 |
|------|------|
| `username` | `@IsNotEmpty()`, `@MinLength(3)`, `@MaxLength(50)`, `@Matches(/^[a-zA-Z0-9_]+$/)` |
| `password` | `@IsNotEmpty()`, `@MinLength(8)`, `@MaxLength(100)`, `@Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/)` |
| `realName` | `@IsNotEmpty()`, `@MaxLength(100)` |
| `email` | `@IsNotEmpty()`, `@IsEmail()`, `@MaxLength(100)` |
| `applyReason` | `@IsOptional()`, `@MaxLength(500)` |

[`ListApplicationDto`](apps/api/src/admin/register-application/dto/list-application.dto.ts:5) 使用 `@Transform` 将字符串参数转为数字：

```typescript
@Transform(({ value }) => parseInt(value, 10))
@IsInt() @Min(1)
page?: number = 1;
```

[`ReviewApplicationDto`](apps/api/src/admin/register-application/dto/review-application.dto.ts:9) 仅一个可选字段：

```typescript
@IsOptional() @IsString() @MaxLength(500)
reviewNote?: string;
```

### 7.2 前端 Schema（Zod）

前端使用 [`zod`](apps/admin-next/src/views/RegisterApply.tsx:22) 提供即时客户端验证：

```typescript
const schema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(100).regex(/^(?=.*[A-Za-z])(?=.*\d).+$/),
  confirmPassword: z.string().min(1),
  realName: z.string().min(1).max(100),
  email: z.string().email().max(100),
  applyReason: z.string().max(500).optional(),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});
```

前端多了一个 `confirmPassword` 确认密码字段（后端不需要存储），通过 `.refine()` 实现密码一致性校验。

---

## 8. 控制器路由设计

[`register-application.controller.ts`](apps/api/src/admin/register-application/register-application.controller.ts) 使用**两个独立的 Controller 类**来隔离权限：

### 8.1 [`ApplyController`](apps/api/src/admin/register-application/register-application.controller.ts:30) — 公开接口

```typescript
@ApiTags('Admin Register Application')
@Controller('auth/admin/apply')
export class ApplyController {
  /** Submit a new account application (public, no JWT) */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  async apply(@Body() dto: CreateApplicationDto, @RealIp() ip: string) {
    return this.svc.create(dto, ip);
  }
}
```

- **公开访问**：无需 JWT Token
- **限流**：15 分钟 5 次
- **IP 注入**：使用 [`@RealIp()`](apps/api/src/common/decorators/http.decorators.ts) 装饰器获取真实 IP（穿透反向代理）
- **返回**：`201 Created`

### 8.2 [`ApplicationsAdminController`](apps/api/src/admin/register-application/register-application.controller.ts:50) — SUPER_ADMIN 接口

```typescript
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
@Controller('admin/applications')
export class ApplicationsAdminController {
  @Get()           findAll(@Query() query: ListApplicationDto)
  @Get('pending-count') pendingCount()
  @Patch(':id/approve') approve(@Param('id') id, @CurrentUserId() reviewerId)
  @Patch(':id/reject') reject(@Param('id') id, @Body() dto, @CurrentUserId() reviewerId)
}
```

- **三层守卫**：`JwtAuthGuard`（身份验证）→ `PermissionsGuard`（权限检查）→ `RolesGuard`（角色匹配）
- **角色限制**：仅 `@Roles(Role.SUPER_ADMIN)` 可访问
- **审核者注入**：使用 [`@CurrentUserId()`](apps/api/src/common/decorators/user.decorator.ts) 从 JWT token 中提取审核人 ID

---

## 9. 前端组件详解

### 9.1 公开申请页 [`RegisterApply`](apps/admin-next/src/views/RegisterApply.tsx:84)

整体结构：

```typescript
export function RegisterApply() {
  const { executeRecaptcha } = useGoogleReCaptcha();
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
  });

  const onSubmit = async (data: FormValues) => {
    let recaptchaToken = '';
    if (executeRecaptcha) {
      recaptchaToken = await executeRecaptcha('admin_apply');
    }
    await applicationApi.submit({ ...data, recaptchaToken });
    setSubmitted(true); // 切换到成功页面
  };
}
```

**UI 布局**：
- 居中卡片式布局，带 Framer Motion 背景动画（渐变模糊圆）
- 6 个表单字段（用户名、姓名、邮箱、密码、确认密码、申请理由）
- 每个 Input 带 Lucide 图标
- 底部 reCAPTCHA 隐私声明
- 提交成功后显示 [`SuccessScreen`](apps/admin-next/src/views/RegisterApply.tsx:51) 组件（CheckCircle 动画 + 返回登录按钮）

**错误处理**：

```typescript
const msg = e?.response?.data?.message || e?.message || 'Submission failed.';
setServerError(Array.isArray(msg) ? msg.join(', ') : msg);
```

后端 `class-validator` 的错误信息可能以数组形式返回，前端统一处理为字符串。

### 9.2 页面包装器

[`register-apply/page.tsx`](apps/admin-next/src/app/register-apply/page.tsx:19)：

```typescript
export default function RegisterApplyPage() {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? '';
  return (
    <RecaptchaClientProvider siteKey={siteKey}>
      <RegisterApply />
    </RecaptchaClientProvider>
  );
}
```

使用 [`RecaptchaClientProvider`](apps/admin-next/src/components/RecaptchaClientProvider.tsx) 包装，提供 reCAPTCHA v3 的 Google 站点密钥。Meta 配置了 `robots: { index: false, follow: false }` 禁止搜索引擎收录。

### 9.3 管理员审批面板 [`ApplicationsManagement`](apps/admin-next/src/views/admin/ApplicationsManagement.tsx:114)

已在第 5 节详细讨论，补充几个实现细节：

**状态 Badge** 使用自定义组件，不同状态匹配不同颜色和图标：

```typescript
function StatusBadge({ status, t }) {
  if (status === 'pending')
    return <Badge color="yellow"><Clock size={12} /> Pending</Badge>;
  if (status === 'approved')
    return <Badge color="green"><CheckCircle size={12} /> Approved</Badge>;
  return <Badge color="red"><XCircle size={12} /> Rejected</Badge>;
}
```

**事件通信**：审批操作后通过 `window.dispatchEvent(new Event('applications:pending-updated'))` 触发自定义事件，通知父组件（[`AdminUserManagementClient`](apps/admin-next/src/components/admin-users/AdminUserManagementClient.tsx)）更新顶部 Tab Badge。

### 9.4 API 客户端

```typescript
export const applicationApi = {
  submit: (data) => http.post('/v1/auth/admin/apply', data),
  getList: (params) => http.get('/v1/admin/applications', params),
  pendingCount: () => http.get('/v1/admin/applications/pending-count', undefined, {
    trace: false,
    showError: false,   // 403 时静默处理
  }),
  approve: (id) => http.patch(`/v1/admin/applications/${id}/approve`),
  reject: (id, reviewNote) => http.patch(`/v1/admin/applications/${id}/reject`, { reviewNote }),
};
```

注意 `submit` 对应公开路由 `/v1/auth/admin/apply`（无 Authorization header），其他接口对应受保护路由 `/v1/admin/applications/*`。

---

## 10. 完整申请到审批流程

### 10.1 时序图

```
Applicant              Frontend              API                     DB/Redis          Email
   │                      │                   │                        │                 │
   │  填写表单 + reCAPTCHA │                   │                        │                 │
   ├─────────────────────►│                   │                        │                 │
   │                      │  POST /apply      │                        │                 │
   │                      ├──────────────────►│                        │                 │
   │                      │                   │  ① reCAPTCHA v3 verify │                 │
   │                      │                   ├───► Google ───────────►│                 │
   │                      │                   │  ② Redis IP check      │                 │
   │                      │                   ├───────► Redis GET ────►│                 │
   │                      │                   │  ③ 临时邮箱检测        │                 │
   │                      │                   │  ④ 用户名查重          │                 │
   │                      │                   ├───────► AdminUser ────►│                 │
   │                      │                   │  ⑤ 待审批查重          │                 │
   │                      │                   ├───────► Application ──►│                 │
   │                      │                   │  创建记录 + Redis 计数  │                 │
   │                      │                   ├───────► Redis SET ────►│                 │
   │                      │  201 Created      │  发送通知（异步）       │                 │
   │                      │◄──────────────────├───────────────────────────► Email Svc   │
   │                      │                   │                        │                 │
   │  成功页面            │                   │                        │                 │
   │◄─────────────────────│                   │                        │                 │
   │                      │                   │                        │                 │
   │                      │                   │                        │                 │
 SUPER_ADMIN              │                   │                        │                 │
   │                      │                   │                        │                 │
   │  审批面板加载列表     │                   │                        │                 │
   ├─────────────────────►│  GET /applications │                        │                 │
   │                      ├──────────────────►│────► Application ─────►│                 │
   │                      │◄──────────────────│◄──── List              │                 │
   │◄─────────────────────┤                   │                        │                 │
   │                      │                   │                        │                 │
   │  点击 Approve        │                   │                        │                 │
   ├─────────────────────►│  PATCH /approve   │                        │                 │
   │                      ├──────────────────►│                        │                 │
   │                      │                   │  findPendingOrThrow    │                 │
   │                      │                   │  二次用户名检查        │                 │
   │                      │                   │  $transaction:         │                 │
   │                      │                   │  ├─ AdminUser.create   │                 │
   │                      │                   │  └─ App.update         │                 │
   │                      │                   │  发送通过邮件（异步）  │                 │
   │                      │                   ├───────────────────────────► Email Svc   │
   │                      │  { message }      │                        │                 │
   │                      │◄──────────────────│                        │                 │
   │◄─────────────────────┤                   │                        │                 │
```

### 10.2 邮件通知

系统在三个关键节点发送邮件（均使用 fire-and-forget 模式，不阻塞主流程）：

| 阶段 | 方法 | 收件人 | 内容 |
|------|------|--------|------|
| 提交成功 | [`sendApplicationReceived`](apps/api/src/admin/register-application/register-application.service.ts:140) | 申请人 | 告知已收到申请，等待审核 |
| 审批通过 | [`sendApplicationApproved`](apps/api/src/admin/register-application/register-application.service.ts:248) | 申请人 | 包含用户名，可登录系统 |
| 审批拒绝 | [`sendApplicationRejected`](apps/api/src/admin/register-application/register-application.service.ts:277) | 申请人 | 包含驳回原因 |

所有邮件发送使用 `.catch()` 捕获异常并仅记录日志，确保邮件发送失败不影响主业务流程。

---

## 11. 安全架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                    纵深防御总览                               │
├─────────────┬───────────────────┬────────────────────────────┤
│ 层次         │ 防护措施           │ 代码位置                   │
├─────────────┼───────────────────┼────────────────────────────┤
│ 网络层       │ @Throttle 限流    │ controller.ts:38           │
│             │ @RealIp 真实 IP   │ controller.ts:39           │
├─────────────┼───────────────────┼────────────────────────────┤
│ 应用层       │ reCAPTCHA v3     │ service.ts:83              │
│             │ IP 限流 (Redis)   │ service.ts:308             │
│             │ 临时邮箱阻断       │ service.ts:298             │
│             │ 用户名冲突检查     │ service.ts:92              │
│             │ 重复待审批检查     │ service.ts:101             │
├─────────────┼───────────────────┼────────────────────────────┤
│ 数据层       │ 密码哈希存储      │ service.ts:121             │
│             │ $transaction     │ service.ts:223 (approve)    │
│             │ 二次用户名确认    │ service.ts:213 (approve)    │
│             │ findPendingOrThrow│ service.ts:285             │
├─────────────┼───────────────────┼────────────────────────────┤
│ 权限层       │ JWT 认证          │ controller.ts:47           │
│             │ RolesGuard       │ controller.ts:48           │
│             │ SUPER_ADMIN only  │ controller.ts:48           │
│             │ VIEWER 最小权限   │ service.ts:230             │
└─────────────┴───────────────────┴────────────────────────────┘
```

---

## 12. 与手动创建账号的对比

| 维度 | 手动创建 (`CreateAdminUserModal`) | 自助申请审批 |
|------|-----------------------------------|-------------|
| 操作人 | SUPER_ADMIN | 申请人（公开） |
| 安全性 | 无需额外验证 | 5 层安全守卫 + reCAPTCHA |
| 流程 | 直接创建，即时生效 | 需审批，异步通知 |
| 角色 | 可任意指定 | 默认 VIEWER（最小权限） |
| 密码 | 创建者设置或随机生成 | 申请人自行设置 |
| 适用场景 | 内测期、紧急添加 | 对外开放、批量注册 |

---

## 13. 总结

注册申请审批工作流是 JoyMini 管理后台对外安全开放的第一道门户。其设计精髓在于：

1. **纵深防御** — 5 层安全守卫从人机验证、IP 限流、邮箱过滤到数据查重，层层递进
2. **原子性操作** — 审批通过使用 `$transaction` 保证账号创建和状态更新的原子性
3. **最小权限** — 新账号默认 `VIEWER` 角色，审批者按需提升
4. **异步通知** — 邮件通知完全异步化，不阻塞核心流程
5. **前端后端双重验证** — Zod + class-validator 各自独立验证，互为补充
6. **天然滑动窗口** — Redis IP 计数器的首次 TTL 设计确保了严格的 24 小时窗口

### 相关文章

- [Admin RBAC：用户 & 角色权限管理](docs/blog/articles/admin-next/admin-rbac-authorization.md) — 审批通过后的管理员权限体系
- [Prisma 数据库架构设计](docs/blog/articles/admin-next/prisma-database-architecture.md) — Prisma 模型的整体设计
