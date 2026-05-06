# 演示账号（VIEWER 角色）实施方案 v2

## 1. 背景

面试简历中提供项目 URL 后，面试官需要能登录管理后台查看功能。需要一个**只读演示账号**，可以查看所有页面和数据，但不能进行任何写操作（Create/Update/Delete），且在查看页面时不会因权限不足而报错。

## 2. 当前 VIEWER 权限分析

### 2.1 当前已配置的权限（`rbac.config.ts`）

```typescript
[Role.VIEWER]: [
    `${OpModule.USER}:${OpAction.USER.VIEW}`,         // ✅ 已有
    `${OpModule.ORDER}:${OpAction.ORDER.VIEW}`,       // ✅ 已有
    `${OpModule.MARKETING}:${OpAction.MARKETING.VIEW}`, // ✅ 已有
    // ❌ 缺失 TREASURE.VIEW
    // ❌ 缺失 FINANCE.VIEW
    // ❌ 缺失 FINANCE.CHANNEL_VIEW
],
```

### 2.2 使用 @Roles() 的 Controller（需要补充 VIEWER）

| Controller | GET 接口当前 Roles | 需要修改 |
|-----------|-------------------|---------|
| `stats.controller.ts` | SUPER_ADMIN, ADMIN | + VIEWER |
| `system-config.controller.ts` | SUPER_ADMIN, ADMIN | GET 接口 + VIEWER |
| `operation-log.controller.ts` | SUPER_ADMIN, ADMIN | + VIEWER |
| `notification.controller.ts` | SUPER_ADMIN, ADMIN | GET 接口 + VIEWER |
| `lucky-draw.controller.ts` | SUPER_ADMIN, ADMIN, EDITOR | GET 接口 + VIEWER |

## 3. 修改清单

| # | 文件 | 修改内容 | 类型 |
|---|------|---------|------|
| 1 | `packages/shared/src/config/rbac.config.ts` | VIEWER 添加 `TREASURE.VIEW`, `FINANCE.VIEW`, `FINANCE.CHANNEL_VIEW` | 后端配置 |
| 2 | `apps/api/src/admin/stats/stats.controller.ts` | 两个 GET 接口 `@Roles()` 添加 VIEWER | 后端 |
| 3 | `apps/api/src/admin/system-config/system-config.controller.ts` | 6 个 GET 接口 `@Roles()` 添加 VIEWER；5 个写操作保持原样 | 后端 |
| 4 | `apps/api/src/admin/operation-log/operation-log.controller.ts` | `@Roles()` 添加 VIEWER | 后端 |
| 5 | `apps/api/src/admin/notification/notification.controller.ts` | 2 个 GET 接口添加 VIEWER；2 个 POST 保持原样 | 后端 |
| 6 | `apps/api/src/admin/lucky-draw/lucky-draw.controller.ts` | GET 接口添加 VIEWER；POST/PATCH/DELETE 保持原样 | 后端 |
| 7 | `apps/api/src/admin/auth/auth.controller.ts` | Admin 登录添加 `@Throttle()` 限流 + reCAPTCHA | 后端安全 |
| 8 | `apps/api/src/admin/auth/auth.service.ts` | 登录逻辑集成 reCAPTCHA 验证 | 后端安全 |
| 9 | `apps/admin-next/src/views/Login.tsx` | 添加 reCAPTCHA 前端组件 | 前端安全 |

## 4. 具体修改内容

### 4.1 RBAC 配置修改

**文件**: [`packages/shared/src/config/rbac.config.ts`](packages/shared/src/config/rbac.config.ts:61)

```typescript
[Role.VIEWER]: [
    // 已有
    `${OpModule.USER}:${OpAction.USER.VIEW}`,
    `${OpModule.ORDER}:${OpAction.ORDER.VIEW}`,
    `${OpModule.MARKETING}:${OpAction.MARKETING.VIEW}`,
    // 新增
    `${OpModule.TREASURE}:${OpAction.TREASURE.VIEW}`,
    `${OpModule.FINANCE}:${OpAction.FINANCE.VIEW}`,
    `${OpModule.FINANCE}:${OpAction.FINANCE.CHANNEL_VIEW}`,
],
```

### 4.2 Stats Controller

**文件**: [`apps/api/src/admin/stats/stats.controller.ts`](apps/api/src/admin/stats/stats.controller.ts:18)

将两个 GET 接口的 `@Roles()` 从 `SUPER_ADMIN, ADMIN` 改为 `SUPER_ADMIN, ADMIN, VIEWER`。

### 4.3 System Config Controller

**文件**: [`apps/api/src/admin/system-config/system-config.controller.ts`](apps/api/src/admin/system-config/system-config.controller.ts:21)

GET 接口（6个）添加 VIEWER：
- `@Get()` @ line 26 → `SUPER_ADMIN, ADMIN, VIEWER`
- `@Get('locales')` @ line 57 → `SUPER_ADMIN, ADMIN, VIEWER`
- `@Get('translation/default-source-lang')` @ line 80 → `SUPER_ADMIN, ADMIN, VIEWER`
- `@Get('blog/locales')` @ line 116 → `SUPER_ADMIN, ADMIN, VIEWER`

POST/PATCH/DELETE 接口（5个）保持 `SUPER_ADMIN, ADMIN` 不变，VIEWER 无法操作，会返回 403。

### 4.4 Operation Log Controller

**文件**: [`apps/api/src/admin/operation-log/operation-log.controller.ts`](apps/api/src/admin/operation-log/operation-log.controller.ts:15)

`@Get('list')` 的 `@Roles()` 从 `SUPER_ADMIN, ADMIN` 改为 `SUPER_ADMIN, ADMIN, VIEWER`。

### 4.5 Notification Controller

**文件**: [`apps/api/src/admin/notification/notification.controller.ts`](apps/api/src/admin/notification/notification.controller.ts:21)

GET 接口（2个）添加 VIEWER：
- `@Get('logs')` @ line 22 → `SUPER_ADMIN, ADMIN, VIEWER`
- `@Get('devices/stats')` @ line 32 → `SUPER_ADMIN, ADMIN, VIEWER`

POST 接口（2个：broadcast, targeted）保持 `SUPER_ADMIN, ADMIN` 不变。

### 4.6 Lucky Draw Controller

**文件**: [`apps/api/src/admin/lucky-draw/lucky-draw.controller.ts`](apps/api/src/admin/lucky-draw/lucky-draw.controller.ts:28)

GET 接口添加 VIEWER：
- `@Get('activities')` @ line 33 → `SUPER_ADMIN, ADMIN, EDITOR, VIEWER`
- `@Get('activities/:id')` @ line 40 → `SUPER_ADMIN, ADMIN, EDITOR, VIEWER`
- `@Get('activities/:activityId/prizes')` @ line 70 → `SUPER_ADMIN, ADMIN, EDITOR, VIEWER`
- `@Get('activities/:activityId/results')` @ line 100 → `SUPER_ADMIN, ADMIN, VIEWER`

POST/PATCH/DELETE 保持原样（部分已有 EDITOR，部分仅 ADMIN+SUPER_ADMIN）。

### 4.7 Admin 登录安全加固

#### a) 添加速率限制

**文件**: [`apps/api/src/admin/auth/auth.controller.ts`](apps/api/src/admin/auth/auth.controller.ts:75)

```typescript
@Post('admin/login')
@HttpCode(HttpStatus.OK)
@Throttle({ default: { limit: 5, ttl: 60_000 } })  // 5 次/分钟
async loginAdmin(@Body() dto: AdminLoginDto, @RealIp() ip: string, @UserAgent() ua: string)
```

理由：项目已有 `@nestjs/throttler` 和 `OtpThrottlerGuard` 全局守卫，`@Throttle()` 装饰器已在使用（register-application、OTP、KYC 等），直接添加即可。

#### b) 集成 reCAPTCHA

**文件**: [`apps/api/src/admin/auth/auth.controller.ts`](apps/api/src/admin/auth/auth.controller.ts:75) + [`auth.service.ts`](apps/api/src/admin/auth/auth.service.ts:70)

登录接口添加 reCAPTCHA token 验证。`RecaptchaService` 已在全局模块中可用，只需要在 login DTO 中添加 `recaptchaToken` 字段，并在 `auth.service.ts` 的 `adminLogin()` 中验证。

**文件**: [`apps/api/src/admin/auth/dto/admin-login.dto.ts`](apps/api/src/admin/auth/dto/admin-login.dto.ts:4)

```typescript
export class AdminLoginDto {
    @ApiProperty({ description: 'username', example: 'admin', type: String })
    @IsNotEmpty() @IsString()
    username!: string;

    @ApiProperty({ description: 'password', example: '123456', type: String })
    @IsNotEmpty() @IsString()
    password!: string;

    @ApiProperty({ description: 'reCAPTCHA token', required: false })
    @IsOptional() @IsString()
    recaptchaToken?: string;
}
```

**文件**: [`apps/admin-next/src/views/Login.tsx`](apps/admin-next/src/views/Login.tsx:127)

前端登录时添加 reCAPTCHA token 到请求体。

## 5. 数据脱敏（前端实现方案）

VIEWER 角色查看页面时，个人敏感数据（手机号、真实姓名、证件号、邮箱）需要在前端显示层进行脱敏。

### 5.1 已有基础

**脱敏函数**（[`security-utils.ts`](apps/admin-next/src/lib/security-utils.ts:59)）已全部就绪：
- `maskPhone(phone)` → `138****1234`
- `maskName(name)` → `张*` 或 `李*明`
- `maskIdCard(idCard)` → `1101****1234`
- `maskEmail(email)` → `u***@example.com`

**角色获取**：`useAuthStore((state) => state.userInfo?.role)` 返回当前用户角色。

### 5.2 需要脱敏的 5 个页面

#### ① 用户管理（`UserManagement.tsx` + `UserDetailModal.tsx`）

| 位置 | 字段 | 当前代码 |
|------|------|---------|
| [`UserManagement.tsx:61`](apps/admin-next/src/views/UserManagement.tsx:61) | `phone` | `record.nickname \|\| record.phone` |
| [`UserManagement.tsx:185`](apps/admin-next/src/views/UserManagement.tsx:185) | `nickname` | `row.nickname \|\| t('users_guest')` |
| [`UserManagement.tsx:197`](apps/admin-next/src/views/UserManagement.tsx:197) | `phone` | `row.phone` |
| [`UserDetailModal.tsx:179`](apps/admin-next/src/views/user-management/UserDetailModal.tsx:179) | `phone` | `data.phone` |

**修改方式**：在组件内获取 `role`，将 4 处 render 值包裹 `isViewer ? maskXxx(value) : value`。

#### ② KYC 审核（`KycAuditModal.tsx`）

| 位置 | 字段 | 当前代码 |
|------|------|---------|
| [`KycAuditModal.tsx:286`](apps/admin-next/src/views/kyc/KycAuditModal.tsx:286) | `realName` | `data.realName` |
| [`KycAuditModal.tsx:295`](apps/admin-next/src/views/kyc/KycAuditModal.tsx:295) | `idNumber` | `data.idNumber` |
| [`KycAuditModal.tsx:309`](apps/admin-next/src/views/kyc/KycAuditModal.tsx:309) | `phone` | `data.user?.phone` |
| [`KycAuditModal.tsx:210-217`](apps/admin-next/src/views/kyc/KycAuditModal.tsx:210) | idCardFront/Back | 图片 URL（可模糊处理） |

**特殊处理**：证件图片（idCardFront, idCardBack, faceImage）可添加 CSS `filter: blur(8px)` 并在鼠标悬停时清晰显示，或直接隐藏图片区域。

#### ③ 订单管理（`OrderManagement.tsx`）

| 位置 | 字段 | 当前代码 |
|------|------|---------|
| [`OrderManagement.tsx:168`](apps/admin-next/src/views/OrderManagement.tsx:168) | `nickname` | `data.user.nickname` |
| [`OrderManagement.tsx:169`](apps/admin-next/src/views/OrderManagement.tsx:169) | `phone` | `data.user.phone` |
| [`OrderManagement.tsx:254`](apps/admin-next/src/views/OrderManagement.tsx:254) | `phone` | `info.row.original.user.phone` |

#### ④ 财务模块（5 个文件）

| 文件 | 字段 | 当前代码 |
|------|------|---------|
| [`TransactionList.tsx:97-100`](apps/admin-next/src/views/finance/TransactionList.tsx:97) | `nickname`, `phone` | `row.user?.nickname`, `row.user?.phone` |
| [`TransactionDetailModal.tsx:88-92`](apps/admin-next/src/views/finance/TransactionDetailModal.tsx:88) | `nickname`, `phone` | `data.user?.nickname`, `data.user?.phone` |
| [`WithdrawalList.tsx:142-145`](apps/admin-next/src/views/finance/WithdrawalList.tsx:142) | `nickname`, `phone` | `row.user?.nickname`, `row.user?.phone` |
| [`WithdrawAuditModal.tsx:139-142`](apps/admin-next/src/views/finance/WithdrawAuditModal.tsx:139) | `nickname`, `phone` | `data.user?.nickname`, `data.user?.phone` |
| [`DepositList.tsx:147-150`](apps/admin-next/src/views/finance/DepositList.tsx:147) | `nickname`, `phone` | `row.user?.nickname`, `row.user?.phone` |
| [`DepositDetailModal.tsx:49`](apps/admin-next/src/views/finance/DepositDetailModal.tsx:49) | `nickname`, `phone` | `` `${data.user?.nickname} (${data.user?.phone})` `` |

#### ⑤ Dashboard 最近订单（[`Dashboard.tsx:260`](apps/admin-next/src/views/Dashboard.tsx:260)）

| 字段 | 当前代码 |
|------|---------|
| `nickname` | `order.user?.nickname ?? '—'` |

### 5.3 实现方式

```typescript
// 在组件顶部
import { useAuthStore } from '@/store/useAuthStore';
import { maskPhone, maskName, maskIdCard } from '@/lib/security-utils';

// 在组件内部
const role = useAuthStore((state) => state.userInfo?.role);
const isViewer = role === 'VIEWER';

// 在 JSX 中
{isViewer ? maskPhone(row.phone) : row.phone}
```

### 5.4 可选方案：创建通用 Hook `useDataMasking`

可以创建一个 Hook 来简化使用：

```typescript
// apps/admin-next/src/lib/hooks/useDataMasking.ts
import { useAuthStore } from '@/store/useAuthStore';
import { maskPhone, maskName, maskEmail, maskIdCard } from '@/lib/security-utils';

export function useDataMasking() {
  const role = useAuthStore((state) => state.userInfo?.role);
  const isViewer = role === 'VIEWER';

  return {
    isViewer,
    phone: (v: string) => isViewer ? maskPhone(v) : v,
    name: (v: string) => isViewer ? maskName(v) : v,
    email: (v: string) => isViewer ? maskEmail(v) : v,
    idCard: (v: string) => isViewer ? maskIdCard(v) : v,
  };
}
```

### 5.5 难度评估

**难度：低**（简单易懂，模式固定）
- 所有 4 个脱敏函数已就绪，无需新建
- 角色信息通过 `useAuthStore` 即可获取，无需新 API
- 每个改动点只是给现有 JSX 加一层条件包裹
- 无需修改后端代码
- 总共约 15-20 个改动点，每个改动点仅 1-3 行

## 6. 执行计划 ✅ 已完成

### ✅ 第 1 步：RBAC 配置
修改 [`packages/shared/src/config/rbac.config.ts`](packages/shared/src/config/rbac.config.ts) 添加 VIEWER 权限
- 新增 `TREASURE.VIEW`、`FINANCE.VIEW`、`FINANCE.CHANNEL_VIEW`

### ✅ 第 2 步：Controller @Roles 修改
依次修改 5 个 Controller 的 `@Roles()` 装饰器：
- [`stats.controller.ts`](apps/api/src/admin/stats/stats.controller.ts) — 2 GET 接口
- [`system-config.controller.ts`](apps/api/src/admin/system-config/system-config.controller.ts) — 4 GET 接口
- [`operation-log.controller.ts`](apps/api/src/admin/operation-log/operation-log.controller.ts) — 1 GET 接口
- [`notification.controller.ts`](apps/api/src/admin/notification/notification.controller.ts) — 2 GET 接口
- [`lucky-draw.controller.ts`](apps/api/src/admin/lucky-draw/lucky-draw.controller.ts) — 5 GET 接口

### ✅ 第 3 步：安全加固
- [`auth.controller.ts`](apps/api/src/admin/auth/auth.controller.ts) — 添加 `@Throttle({ default: { limit: 5, ttl: 60_000 } })`
- [`admin-login.dto.ts`](apps/api/src/admin/auth/dto/admin-login.dto.ts) — 添加 `recaptchaToken?: string`
- [`auth.service.ts`](apps/api/src/admin/auth/auth.service.ts) — 集成 `RecaptchaService.verifyToken()`
- [`login/page.tsx`](apps/admin-next/src/app/login/page.tsx) — 包裹 `RecaptchaClientProvider`
- [`Login.tsx`](apps/admin-next/src/views/Login.tsx) — 集成 `useGoogleReCaptcha` 获取 token 并传递
- [`api/index.ts`](apps/admin-next/src/api/index.ts) — 更新 `login` 方法类型支持 `recaptchaToken`

## 7. 操作即报错机制

VIEWER 调用写操作接口（POST/PATCH/DELETE）时会自动返回 403 Forbidden，因为：
- `PermissionsGuard` 检查 `@RequirePermission()` — VIEWER 没有 CREATE/UPDATE/DELETE 权限
- `RolesGuard` 检查 `@Roles()` — 写操作接口没有包含 VIEWER

所以 VIEWER 在查看时无任何报错，只有在点击"创建/修改/删除"时才会收到 403 提示。
