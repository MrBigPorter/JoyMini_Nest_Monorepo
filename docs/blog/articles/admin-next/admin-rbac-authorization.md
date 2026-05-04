# Admin RBAC：用户 & 角色权限管理

## 1. 架构全景

JoyMini Admin 后台的权限管理体系采用 **双系统并行** 的设计，在同一个代码库中共存两套 Guard：

| 系统 | Guard | 装饰器 | 粒度 | 适用场景 |
|------|-------|--------|------|----------|
| **角色级** (旧) | [`RolesGuard`](apps/api/src/admin/auth/roles.guard.ts) | [`@Roles()`](apps/api/src/admin/auth/roles.decorator.ts) | 粗粒度（按角色） | 操作日志、历史遗留模块 |
| **权限级** (新) | [`PermissionsGuard`](apps/api/src/common/guards/permissions.guard.ts) | [`@RequirePermission()`](apps/api/src/common/decorators/require-permission.decorator.ts) | 细粒度（按 `module:action`） | 新产品/新功能 |

两套 Guard 的共同前置依赖是 **JWT 身份认证**，通过 [`AdminJwtAuthGuard`](apps/api/src/admin/auth/admin-jwt-auth.guard.ts) 或 [`JwtAuthGuard`](apps/api/src/common/jwt/jwt.guard.ts) 完成 token 验证后，将用户角色挂载到 `request.user`，再交由权限 Guard 做二次校验。

```
Request → AdminJwtAuthGuard (验证 JWT) → PermissionsGuard/RolesGuard (权限校验) → Controller
```

---

## 2. AdminUser 数据模型

管理员用户模型定义在 [`schema.prisma:156`](apps/api/prisma/schema.prisma:156)：

```prisma
model AdminUser {
  id          String              @id @default(cuid()) @map("admin_id") @db.VarChar(32)
  createdAt   DateTime            @default(now()) @map("created_at")
  updatedAt   DateTime            @updatedAt @map("updated_at")
  deletedAt   DateTime?           @map("deleted_at")
  username    String              @unique @map("username") @db.VarChar(50)
  password    String              @map("password") @db.VarChar(255)
  realName    String?             @map("real_name") @db.VarChar(100)
  role        String              @default("viewer") @map("role") @db.VarChar(50)
  status      Int                 @default(1) @map("status") @db.SmallInt
  lastLoginAt DateTime?           @map("last_login_at")
  lastLoginIp String?             @map("last_login_ip") @db.VarChar(50)

  @@index([status], map: "idx_admin_status")
  @@map("admin_users")
}
```

关键设计点：

- **`role` 字段为字符串而非枚举**：使用 `@db.VarChar(50)`，默认值 `"viewer"`。这种设计保留了未来动态扩展角色的灵活性，无需改表结构。
- **`status` 为 `SmallInt`**：`1`=启用, `0`=禁用。配合 `idx_admin_status` 索引，支持高效的状态筛选。
- **软删除**：`deletedAt` 字段支持逻辑删除，避免物理删除带来的关联数据断裂。
- **`lastLoginAt` / `lastLoginIp`**：记录最后一次登录信息，用于安全审计和前端展示。

### 角色枚举

角色定义在 [`packages/shared/src/types/enums.ts:56`](packages/shared/src/types/enums.ts:56)：

```typescript
export enum Role {
  SUPER_ADMIN = "SUPER_ADMIN", // 超级管理员
  ADMIN       = "ADMIN",       // 普通管理员
  EDITOR      = "EDITOR",      // 编辑/运营
  VIEWER      = "VIEWER",      // 观察者
  FINANCE     = "FINANCE",     // 财务专员
}
```

五个角色形成一个从 **全权限** 到 **只读** 的权限梯度，`FINANCE` 作为独立角色拥有财务相关的特殊权限。

---

## 3. AdminJwtAuthGuard — JWT 身份认证

与常规 NestJS 使用 `@nestjs/jwt` 的 `JwtService` 不同，Admin 后台的认证 Guard 选择了 **直接使用 `jsonwebtoken` 库**，避免每个模块都需要导入 `JwtModule`。

```typescript
// apps/api/src/admin/auth/admin-jwt-auth.guard.ts
@Injectable()
export class AdminJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestLike>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('No admin token provided');
    }

    const secret = process.env.ADMIN_JWT_SECRET
      || process.env.JWT_SECRET
      || 'please_change_me_very_secret';

    try {
      const payloadUnknown: unknown = jwt.verify(token, secret);
      const payload: AdminJwtPayload = isRecord(payloadUnknown)
        ? payloadUnknown : {};

      request.user = {
        id: toStringOrEmpty(payload.sub),
        userId: toStringOrEmpty(payload.sub),
        role: toStringOrEmpty(payload.role),
        type: toStringOrEmpty(payload.type),
        username: toStringOrEmpty(payload.username),
      };
    } catch {
      throw new UnauthorizedException('Invalid or expired admin token');
    }
    return true;
  }
}
```

关键设计：

- **双 Secret 回退**：优先使用 `ADMIN_JWT_SECRET`，回退到 `JWT_SECRET`，兼容不同部署阶段的配置。
- **类型安全的 payload 提取**：通过 `isRecord()` 类型守卫确保 `unknown` 类型的安全访问，避免 `as` 强制转换。
- **`request.user` 挂载**：包含 `id`、`userId`、`role`、`type`、`username` 五个字段，为后续的 Guard 和 Decorator 提供数据源。

### Token 签发

Token 由 [`AuthService`](apps/api/src/admin/auth/auth.service.ts) 的 `issueTokenPair` 方法签发：

```typescript
private async issueTokenPair(user: { id: string; role?: string }) {
  const payload: JwtPayload = { sub: user.id, type: 'admin' };
  if (user.role) {
    payload.role = user.role;
  }

  const [accessToken, refreshToken] = await Promise.all([
    this.jwt.signAsync(payload, {
      expiresIn: process.env.ADMIN_JWT_ACCESS_EXPIRATION || '12h',
      secret: this.getAdminJwtSecret(),
    }),
    this.jwt.signAsync(payload, {
      expiresIn: process.env.ADMIN_JWT_REFRESH_EXPIRATION || '7d',
      secret: this.getAdminJwtSecret(),
    }),
  ]);

  return { accessToken, refreshToken };
}
```

- Access Token 默认可配置 12 小时有效
- Refresh Token 默认 7 天有效
- Token 中嵌入 `type: 'admin'` 标签，Refresh 时校验防止类型混淆

---

## 4. RolesGuard — 角色级别权限控制

RolesGuard 是 **粗粒度** 的角色校验系统，适用于操作日志等对权限粒度要求不高的场景。

### 装饰器

```typescript
// apps/api/src/admin/auth/roles.decorator.ts
export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
```

### Guard 实现

```typescript
// apps/api/src/admin/auth/roles.guard.ts
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // 没有 @Roles() 装饰 → 放行
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestLike>();
    if (!isUserLike(request.user) || typeof request.user.role !== 'string') {
      throw new UnauthorizedException('User not authenticated');
    }

    const userRole = request.user.role as Role;
    const hasRole = requiredRoles.includes(userRole);
    if (!hasRole) {
      throw new ForbiddenException(
        `Requires one of: [${requiredRoles.join(', ')}], but user has role: ${userRole}`,
      );
    }
    return true;
  }
}
```

### 使用示例

```typescript
// apps/api/src/admin/operation-log/operation-log.controller.ts
@Controller('admin/operation-logs')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class OperationLogController {
  @Get('list')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)  // 只有超管和管理员可以查看
  async getList(@Query() query: QueryOperationLogDto) {
    return this.operationLogService.getList(query);
  }
}
```

RolesGuard 的优点是简单直接，缺点是仅能做到"角色级别"的开关——要么整个角色能访问，要么不能，无法精确到"ADMIN 角色只能查看用户，不能编辑用户"。

---

## 5. PermissionsGuard — 权限级别细粒度控制

PermissionsGuard 是 **细粒度** 的权限控制系统，通过 `module:action` 字符串精确控制每个接口的访问权限。

### 装饰器

```typescript
// apps/api/src/common/decorators/require-permission.decorator.ts
export const PERMISSION_KEY = 'permissions';

export const RequirePermission = (module: string, action: string) => {
  const permissionString = `${module}:${action}`;
  return SetMetadata(PERMISSION_KEY, permissionString);
};
```

### Guard 实现

```typescript
// apps/api/src/common/guards/permissions.guard.ts
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 1. 获取路由上的 @RequirePermission 标签内容
    const requiredPermission = this.reflector.get<string>(
      PERMISSION_KEY,
      context.getHandler(),
    );

    // 2. 没加 @RequirePermission → 直接放行
    if (!requiredPermission) {
      return true;
    }

    // 3. 获取当前用户角色
    const request = context.switchToHttp()
      .getRequest<{ user?: { role?: Role } }>();
    const user = request.user;
    const role = user?.role;

    if (!user || !role) {
      throw new UnauthorizedException('unauthorized');
    }

    // 4. 超级管理员跳过所有检查
    if (role === Role.SUPER_ADMIN) {
      return true;
    }

    // 5. 核心：从 RolePermissions 配置表查询当前角色的权限
    const userPermissions = RolePermissions[role] ?? [];
    const hasPermission = userPermissions.includes(requiredPermission);

    if (!hasPermission) {
      throw new ForbiddenException(`no permission: ${requiredPermission}`);
    }
    return true;
  }
}
```

### 使用示例

```typescript
// apps/api/src/admin/treasure/treasure.controller.ts
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TreasureController {
  @Post()
  @RequirePermission(OpModule.TREASURE, OpAction.TREASURE.CREATE)
  async create(@Body() dto: CreateTreasureDto) {
    return this.treasureService.create(dto);
  }

  @Delete(':id')
  @RequirePermission(OpModule.TREASURE, OpAction.TREASURE.DELETE)
  async remove(@Param('id') id: string) {
    return this.treasureService.remove(id);
  }
}
```

```typescript
// apps/api/src/admin/banner/banner.controller.ts
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BannerController {
  @Post()
  @RequirePermission(OpModule.MARKETING, OpAction.MARKETING.CREATE)
  async create(@Body() dto: CreateBannerDto) { ... }

  @Put(':id')
  @RequirePermission(OpModule.MARKETING, OpAction.MARKETING.UPDATE)
  async update(@Param('id') id: string, @Body() dto: UpdateBannerDto) { ... }
}
```

### 权限系统的核心思想

PermissionsGuard 本身不做权限定义——它只做 **匹配**。真正的权限规则配置在 [`RolePermissions`](packages/shared/src/config/rbac.config.ts) 表中：

```
角色 (Role) ───→  RolePermissions[role] ───→  string[]
                                                    │
Controller ───→  @RequirePermission(m, a) ───→    匹配
```

这种设计实现了 **权限定义与校验逻辑的解耦**：修改某个角色的权限只需改配置表，不需要动 Guard 代码。

---

## 6. OpModule / OpAction 枚举体系

完整的权限动作定义在 [`packages/shared/src/constants/operation-log.constants.ts`](packages/shared/src/constants/operation-log.constants.ts)，分为三个层次：

### 操作类型 (OpType)

```typescript
export enum OpType {
  QUERY  = 1,  // 查询/查看
  CREATE = 2,  // 新增
  UPDATE = 3,  // 修改/更新
  DELETE = 4,  // 删除
  AUDIT  = 5,  // 审核
  EXPORT = 6,  // 导出数据
  OTHER  = 99, // 其他操作
}
```

### 业务模块 (OpModule)

```typescript
export enum OpModule {
  USER     = "user_management",      // 用户管理
  TREASURE = "treasure_management",  // 产品/夺宝管理
  ORDER    = "order_management",     // 订单管理
  FINANCE  = "finance_management",   // 财务管理
  MARKETING= "marketing_management", // 营销活动
  SYSTEM   = "system_management",    // 系统配置
  CS       = "customer_service",     // 客服中心
}
```

### 具体动作 (OpAction)

每个模块包含多个具体动作，以用户模块为例：

```typescript
export const OpAction = {
  USER: {
    VIEW:           "view_user",           // 查看用户详情
    UPDATE:         "update_user_info",    // 修改用户信息
    KYC_AUDIT:      "audit_kyc",           // 审核KYC
    BAN:            "ban_user",            // 封禁用户
    UNBAN:          "unban_user",          // 解封用户
    ADJUST_BALANCE: "adjust_balance",      // 调整余额 (高危)
    DELETE:         "delete_user",         // 删除用户
    CREATE:         "create_user",         // 创建用户
  },
  TREASURE: { /* VIEW, CREATE, UPDATE, ON_SHELF, OFF_SHELF, LOTTERY, DELETE */ },
  ORDER:    { /* VIEW, CANCEL, REFUND_AUDIT, EXPORT, UPDATE, DELETE */ },
  FINANCE:  { /* VIEW, MANUAL_ADJUST, WITHDRAW_AUDIT, RECHARGE_AUDIT, EXPORT, ... */ },
  MARKETING:{ /* VIEW, CREATE, UPDATE, SEND_COUPON, DELETE */ },
  SYSTEM:   { /* CREATE_ADMIN, UPDATE_ROLE, CONFIG, SEND_NOTIF */ },
  CS:       { /* REPLY, CLOSE */ },
};
```

共 **7 个模块、30+ 个具体动作**，覆盖所有后台管理场景。

### UI 展示映射

前端下拉框和日志列表使用对应的中文标签：

```typescript
export const OpModuleLabel: Record<string, string> = {
  [OpModule.USER]:     "用户管理",
  [OpModule.TREASURE]: "产品管理",
  [OpModule.ORDER]:    "订单管理",
  [OpModule.FINANCE]:  "财务管理",
  [OpModule.MARKETING]:"营销管理",
  [OpModule.SYSTEM]:   "系统设置",
  [OpModule.CS]:       "客服中心",
};

export const OpTypeLabel: Record<number, string> = {
  [OpType.QUERY]:  "查询",
  [OpType.CREATE]: "新增",
  [OpType.UPDATE]: "修改",
  [OpType.DELETE]: "删除",
  [OpType.AUDIT]:  "审核",
  [OpType.EXPORT]: "导出",
  [OpType.OTHER]:  "其他",
};
```

---

## 7. RolePermissions — 权限配置表

权限配置表 [`RolePermissions`](packages/shared/src/config/rbac.config.ts) 定义了每个角色拥有的权限集合，是整个 RBAC 系统的 **核心业务逻辑**。

### 角色权限矩阵

| 权限 | SUPER_ADMIN | ADMIN | EDITOR | VIEWER | FINANCE |
|------|:-----------:|:-----:|:------:|:------:|:-------:|
| user:view | ✅ | ✅ | ✅ | ✅ | — |
| user:update | ✅ | ✅ | — | — | — |
| user:ban | ✅ | ✅ | — | — | — |
| order:view | ✅ | ✅ | — | ✅ | ✅ |
| order:export | ✅ | ✅ | — | — | ✅ |
| marketing:view | ✅ | ✅ | ✅ | ✅ | — |
| marketing:create | ✅ | ✅ | ✅ | — | — |
| marketing:update | ✅ | ✅ | ✅ | — | — |
| treasure:view | ✅ | ✅ | — | — | — |
| treasure:create | ✅ | ✅ | — | — | — |
| treasure:delete | ✅ | ✅ | — | — | — |
| finance:view | ✅ | ✅ | — | — | ✅ |
| finance:withdraw_audit | ✅ | — | — | — | ✅ |
| finance:recharge_audit | ✅ | — | — | — | ✅ |

### 配置示例

```typescript
export const RolePermissions = {
  [Role.ADMIN]: [
    `${OpModule.USER}:${OpAction.USER.VIEW}`,
    `${OpModule.USER}:${OpAction.USER.UPDATE}`,
    `${OpModule.USER}:${OpAction.USER.BAN}`,
    `${OpModule.ORDER}:${OpAction.ORDER.VIEW}`,
    `${OpModule.ORDER}:${OpAction.ORDER.EXPORT}`,
    `${OpModule.MARKETING}:${OpAction.MARKETING.VIEW}`,
    `${OpModule.MARKETING}:${OpAction.MARKETING.CREATE}`,
    `${OpModule.MARKETING}:${OpAction.MARKETING.UPDATE}`,
    `${OpModule.FINANCE}:${OpAction.FINANCE.VIEW}`,
    `${OpModule.FINANCE}:${OpAction.FINANCE.CHANNEL_VIEW}`,
    `${OpModule.TREASURE}:${OpAction.TREASURE.VIEW}`,
    `${OpModule.TREASURE}:${OpAction.TREASURE.CREATE}`,
    `${OpModule.TREASURE}:${OpAction.TREASURE.UPDATE}`,
    `${OpModule.TREASURE}:${OpAction.TREASURE.ON_SHELF}`,
    `${OpModule.TREASURE}:${OpAction.TREASURE.OFF_SHELF}`,
    `${OpModule.TREASURE}:${OpAction.TREASURE.LOTTERY}`,
    `${OpModule.TREASURE}:${OpAction.TREASURE.DELETE}`,
  ],
  [Role.EDITOR]: [
    `${OpModule.USER}:${OpAction.USER.VIEW}`,
    `${OpModule.MARKETING}:${OpAction.MARKETING.VIEW}`,
    `${OpModule.MARKETING}:${OpAction.MARKETING.CREATE}`,
    `${OpModule.MARKETING}:${OpAction.MARKETING.UPDATE}`,
    // 注意：没给 DELETE 权限
  ],
  [Role.VIEWER]: [
    `${OpModule.USER}:${OpAction.USER.VIEW}`,
    `${OpModule.ORDER}:${OpAction.ORDER.VIEW}`,
    `${OpModule.MARKETING}:${OpAction.MARKETING.VIEW}`,
  ],
  [Role.FINANCE]: [
    `${OpModule.FINANCE}:${OpAction.FINANCE.VIEW}`,
    `${OpModule.FINANCE}:${OpAction.FINANCE.WITHDRAW_AUDIT}`,
    `${OpModule.FINANCE}:${OpAction.FINANCE.RECHARGE_AUDIT}`,
    `${OpModule.FINANCE}:${OpAction.FINANCE.EXPORT}`,
    `${OpModule.FINANCE}:${OpAction.FINANCE.CHANNEL_VIEW}`,
    `${OpModule.ORDER}:${OpAction.ORDER.VIEW}`,
    `${OpModule.ORDER}:${OpAction.ORDER.EXPORT}`,
  ],
} satisfies Partial<Record<Role | string, readonly string[]>>;
```

关键设计：

- **SUPER_ADMIN 硬编码放行**：在 PermissionsGuard 中直接 `role === Role.SUPER_ADMIN` → `return true`，不经过配置表。这保证了超级管理员永远拥有全权限，且配置表误删也不会影响。
- **`satisfies` 类型约束**：确保每个角色的权限数组类型安全。
- **注释即文档**：每个权限旁边都有中文注释，例如 `// 注意：没给他 DELETE 权限` 让开发者一目了然。

---

## 8. Admin 登录流程

管理员登录是 RBAC 系统的入口，经过精心设计以防止各种攻击向量。

### 登录接口

```typescript
// POST /auth/admin/login
async adminLogin(
  { username, password }: AdminLoginDto,
  ip: string,
  ua: string,
) {
  // 1. 查找用户
  const admin = await this.prisma.adminUser.findUnique({
    where: { username },
    select: { status: true, password: true, id: true,
             username: true, realName: true, role: true },
  });

  // 2. 用户不存在 → Mock 密码比对防计时攻击
  if (!admin) {
    await this.passwordService.compare(password, '$2b$10$...');
    await this.loginAuth(false, { username, ip, ua, adminId: null });
    throw invalid();
  }

  // 3. 验证密码
  const isMatch = await this.passwordService.compare(password, admin.password);
  if (!isMatch) {
    await this.loginAuth(false, { username, ip, ua, adminId: admin.id });
    throw invalid();
  }

  // 4. 密码正确后再检查状态（防止区分"密码错"还是"账号被封"）
  if (admin.status != 1) {
    await this.loginAuth(false, { username, ip, ua, adminId: admin.id });
    throw new BadRequestException('user is disabled, please contact admin');
  }

  // 5. 事务：更新登录时间 + 写操作日志
  const result = await this.prisma.$transaction(async (ctx) => {
    const updatedUser = await ctx.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date(), lastLoginIp: ip },
    });
    await ctx.adminOperationLog.create({
      data: {
        adminId: admin.id,
        adminName: admin.realName || admin.username,
        module: 'auth',
        action: 'login',
        requestIp: ip,
        details: JSON.stringify({ msg: 'login success', ip, ua }),
      },
    });
    return updatedUser;
  });

  // 6. 签发 Token
  const tokens = await this.issueTokenPair({ id: admin.id, role: admin.role });
  return { tokens, userInfo: { /* ... */ } };
}
```

### 安全设计亮点

- **计时攻击防护**：用户不存在时，用固定 Hash 模拟 bcrypt 比对耗时，攻击者无法通过响应时间差异判断用户是否存在。
- **统一错误信息**：用户不存在和密码错误都返回 `"invalid username or password"`，不透露是哪个字段错了。
- **状态检查后置**：先验密码再验状态，攻击者无法通过错误提示区分"密码错"和"账号被封"。
- **登录失败日志**：无论失败原因（用户不存在 / 密码错 / 已禁用），都记录 `login_fail` 操作日志，便于审计。
- **事务写入**：更新 `lastLoginAt` 和写入操作日志在同一个 `$transaction` 中，保证数据一致性。

### GET /auth/admin/me

用于前端页面刷新后从 JWT 恢复用户信息：

```typescript
@Get('admin/me')
@HttpCode(HttpStatus.OK)
@UseGuards(JwtAuthGuard)
async getAdminMe(@CurrentUserId() userId: string) {
  const admin = await this.prisma.adminUser.findUnique({
    where: { id: userId },
    select: { id: true, username: true, realName: true,
             role: true, status: true, lastLoginAt: true },
  });
  if (!admin) throw new UnauthorizedException('admin not found');
  return { /* id, username, realName, role, status, lastLoginAt */ };
}
```

### HttpOnly Cookie

登录成功后，前端调用 `POST /auth/admin/set-cookie` 由后端设置 HttpOnly Cookie：

```typescript
@Post('admin/set-cookie')
async setAuthCookie(@Body() dto: SetCookieDto,
                    @Res({ passthrough: true }) res: Response) {
  await this.auth.verifyAdminToken(dto.token);
  res.cookie('auth_token', dto.token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'strict' : 'lax',
    maxAge: 24 * 60 * 60 * 1000,
    ...(isProd ? { domain: '.joyminis.com' } : {}),
  });
  return { ok: true };
}
```

- **HttpOnly**：JS 无法读取，防御 XSS 攻击
- **Secure**：生产环境仅 HTTPS
- **SameSite=strict**：生产环境严格同站策略，防御 CSRF
- **Domain 共享**：`.joyminis.com` 允许 `api.joyminis.com` 设置的 Cookie 被 `admin.joyminis.com` 的 Next.js Middleware 读取

---

## 9. AdminRegisterApplication — 注册申请审批工作流

系统支持 **自助申请管理员账号** 的流程，模型定义在 [`schema.prisma:177`](apps/api/prisma/schema.prisma:177)：

```prisma
model AdminRegisterApplication {
  id          String    @id @default(cuid()) @map("app_id") @db.VarChar(32)
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  /// 申请人填写
  username    String    @map("username") @db.VarChar(50)
  password    String    @map("password") @db.VarChar(255)
  realName    String    @map("real_name") @db.VarChar(100)
  email       String    @map("email") @db.VarChar(100)
  applyReason String?   @map("apply_reason")
  applyIp     String?   @map("apply_ip") @db.VarChar(50)

  /// 审批状态: pending | approved | rejected
  status      String    @default("pending") @map("status") @db.VarChar(20)

  /// 审批信息
  reviewedBy  String?   @map("reviewed_by") @db.VarChar(32)
  reviewNote  String?   @map("review_note")
  reviewedAt  DateTime? @map("reviewed_at")

  @@index([status],     map: "idx_app_status")
  @@index([email],      map: "idx_app_email")
  @@index([username],   map: "idx_app_username")
  @@index([createdAt],  map: "idx_app_created_at")
  @@map("admin_register_applications")
}
```

审批流状态机：

```
提交申请 → pending ─┬→ approved (超管审批通过 → 自动创建 AdminUser)
                    └→ rejected (超管拒绝 → 反馈原因)
```

- `password` 在提交时即使用 bcrypt 哈希存储
- `applyIp` 记录申请时的 IP，用于安全审计
- 审批时记录 `reviewedBy`、`reviewNote`、`reviewedAt`，形成完整审批链
- 四个索引覆盖所有查询场景（按状态筛选、按邮箱/用户名搜索、按时间排序）

---

## 10. AdminOperationLog — 审计日志

操作日志是 RBAC 体系中不可或的一环，用于记录管理员的所有关键操作，支持事后审计和问题追踪。

### 数据模型

```prisma
model AdminOperationLog {
  id        String     @id @default(cuid()) @map("log_id") @db.VarChar(32)
  createdAt DateTime   @default(now()) @map("created_at")
  adminId   String?    @map("admin_id")
  adminName String     @map("admin_name") @db.VarChar(100)
  module    String     @map("module") @db.VarChar(100)
  action    String     @map("action") @db.VarChar(100)
  details   String?    @map("details")
  requestIp String?    @map("request_ip") @db.VarChar(50)
  admin     AdminUser? @relation(fields: [adminId], references: [id], onDelete: Restrict)

  @@index([adminId])
  @@index([module, action])
  @@index([createdAt])
  @@map("admin_operation_logs")
}
```

### 写入接口

[`OperationLogService`](apps/api/src/admin/operation-log/operation-log.service.ts) 提供统一的日志写入方法：

```typescript
export interface WriteLogParams {
  adminId: string;
  adminName: string;
  module: string;     // 对应 OpModule
  action: string;     // 对应 OpAction 或自定义操作名
  details?: string;   // JSON 格式的详细数据
  requestIp?: string;
}

@Injectable()
export class OperationLogService {
  async log(params: WriteLogParams): Promise<void> {
    await this.prisma.adminOperationLog.create({ data: { /* ... */ } });
  }
}
```

### 查询接口

支持多维动态筛选：

```typescript
async getList(query: QueryOperationLogDto) {
  const where: Prisma.AdminOperationLogWhereInput = {};

  // 按管理员筛选
  if (adminId) where.adminId = adminId;

  // 按操作类型筛选（对 GENERIC_ACTION 做模糊匹配，其他精确匹配）
  if (action && action !== 'ALL') {
    where.action = GENERIC_ACTION_FILTERS.has(loweredAction)
      ? { contains: loweredAction, mode: 'insensitive' }
      : { equals: normalizedAction, mode: 'insensitive' };
  }

  // 按关键词搜索（跨 adminName / details / module / action）
  if (keyword) {
    where.OR = [
      { adminName: { contains: keyword, mode: 'insensitive' } },
      { details:   { contains: keyword, mode: 'insensitive' } },
      { module:    { contains: keyword, mode: 'insensitive' } },
      { action:    { contains: keyword, mode: 'insensitive' } },
    ];
  }

  // 按日期范围筛选
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = TimeHelper.getStartOfDay(startDate);
    if (endDate)   where.createdAt.lte = TimeHelper.getEndOfDay(endDate);
  }

  const [list, total] = await Promise.all([
    this.prisma.adminOperationLog.findMany({
      where, skip: (page - 1) * pageSize, take: pageSize,
      orderBy: { createdAt: 'desc' },
      include: { admin: { select: { id: true, username: true, realName: true } } },
    }),
    this.prisma.adminOperationLog.count({ where }),
  ]);

  return { list, total, page, pageSize };
}
```

查询设计要点：

- **`GENERIC_ACTION_FILTERS`**：对 `login`/`logout`/`create`/`update`/`delete`/`audit`/`export` 等通用操作名使用 `contains` 模糊匹配，捕捉不同语言/格式的变体（如 `LOGIN`、`login`、`login_fail`）。
- **非通用操作精确匹配**：自定义操作名（如 Kafka 任务名）使用 `equals` 精确匹配，避免误匹配。
- **关联查询**：`include: { admin }` 返回管理员基本资料，便于前端展示操作人详情。

### 控制器层

```typescript
@Controller('admin/operation-logs')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class OperationLogController {
  @Get('list')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async getList(@Query() query: QueryOperationLogDto) {
    return this.operationLogService.getList(query);
  }
}
```

操作日志列表仅允许 `SUPER_ADMIN` 和 `ADMIN` 角色查看，使用 RolesGuard 做粗粒度控制。

---

## 11. AdminPushLog — 推送日志

管理员在后台发送推送通知时，每条推送记录都会被持久化到 [`AdminPushLog`](apps/api/prisma/schema.prisma:224)：

```prisma
model AdminPushLog {
  id           String    @id @default(cuid()) @map("push_log_id") @db.VarChar(32)
  createdAt    DateTime  @default(now()) @map("created_at")
  adminId      String    @map("admin_id") @db.VarChar(32)
  adminName    String    @map("admin_name") @db.VarChar(100)
  type         String    @map("type") @db.VarChar(20)      // broadcast | targeted
  targetUserId String?   @map("target_user_id") @db.VarChar(32)
  title        String    @map("title") @db.VarChar(200)
  body         String    @map("body")
  extraData    Json?     @map("extra_data")
  status       String    @default("sent") @map("status") @db.VarChar(20) // sent | failed
  successCount Int       @default(0) @map("success_count")
  failCount    Int       @default(0) @map("fail_count")
  admin        AdminUser @relation(fields: [adminId], references: [id], onDelete: Restrict)
  ...
}
```

关键设计：

- **双通道**：`broadcast`（全员广播）和 `targeted`（定向推送）两种类型，使用字符串枚举
- **结果追踪**：`successCount` / `failCount` 记录推送结果统计
- **附加数据**：`extraData Json` 字段存储推送附带的业务数据（如跳转链接）
- **`onDelete: Restrict`**：限制删除已记录推送日志的管理员，保证审计链条完整

---

## 12. admin-next 前端管理界面

前端的管理员管理界面位于 [`AdminUserManagement`](apps/admin-next/src/components/admin-users/AdminUserManagementClient.tsx)，提供完整的 CRUD 操作。

### 功能概览

- **双 Tab 视图**：用户列表（Users）和注册申请（Applications）
- **多维搜索**：按用户名、真实姓名、角色、状态筛选
- **列表展示**：ID（缩写）、用户名、真实姓名、角色（彩色 Badge）、状态（启用/禁用）、最后登录时间/IP
- **操作按钮**：编辑、重置密码、启用/禁用
- **创建管理员**：弹出 CreateAdminUserModal
- **注册申请审批**：ApplicationsManagement 组件，仅 SUPER_ADMIN 可见

### 权限控制前端实现

```typescript
export const AdminUserManagement: React.FC = () => {
  const userInfo = useAuthStore((state) => state.userInfo);
  const canReviewApplications = userInfo?.role === 'SUPER_ADMIN';
  const isSuperAdmin = userInfo?.role === 'SUPER_ADMIN';
  // ...
  
  // 非 SUPER_ADMIN 不能操作 SUPER_ADMIN 账号
  const handleToggleStatus = useCallback(async (admin: AdminUser) => {
    if (admin.role === 'SUPER_ADMIN' && !isSuperAdmin) {
      addToast('error', t('adminUsers.onlySuperAdminModify'));
      return;
    }
    // ...
  }, []);
};
```

前端通过 `useAuthStore` 中存储的 `userInfo.role` 做 UI 级别的权限控制：

- **SUPER_ADMIN**：所有操作可用，包括审批注册申请
- **非 SUPER_ADMIN**：编辑/禁用/重置密码按钮对 SUPER_ADMIN 账号灰显
- **角色 Badge** 颜色映射：`SUPER_ADMIN = purple`, `ADMIN = blue`, `EDITOR = green`

### 登录页

[`Login`](apps/admin-next/src/views/Login.tsx) 使用 Zod + react-hook-form 做表单验证：

```typescript
const loginSchema = (t: (key: string) => string) =>
  z.object({
    username: z.string().min(1).max(50),
    password: z.string().min(6).max(128),
  });
```

页面底部包含 "Apply for access" 链接，跳转到 `/register-apply` 注册申请页。

---

## 13. 安全设计总结

### 设计原则

| 原则 | 实现方式 |
|------|----------|
| **纵深防御** | JWT 认证 → RolesGuard/PermissionsGuard → Controller 三层校验 |
| **最小权限** | VIEWER 仅只读，EDITOR 不能删除，FINANCE 专属财务权限 |
| **默认拒绝** | 没有 `@RequirePermission` 的接口默认放行（兼容旧接口），新建功能必须显式标注 |
| **攻击面最小化** | HttpOnly Cookie 防 XSS，SameSite 防 CSRF，计时攻击防护 |
| **完整审计** | 每一步关键操作都写 AdminOperationLog |
| **权限与逻辑解耦** | 权限规则集中在 RolePermissions 配置表，Guard 只做匹配 |

### 依赖关系

```
admin-next (React) ──HTTP──→ api (NestJS)
                                │
                    ┌───────────┴───────────┐
                    │                       │
            AdminJwtAuthGuard          PermissionsGuard
            (验证 JWT)                    (校验权限)
                    │                       │
                    ↓                       ↓
              request.user.role      RolePermissions[role]
                    │                       │
                    └───────────┬───────────┘
                                ↓
                          Controller
                                ↓
                     OperationLogService.log()
```

### 扩展建议

1. **动态角色**：当前角色硬编码在 `RolePermissions` 配置表中，可扩展为数据库存储的角色-权限关联表，支持运行时自定义角色。
2. **权限缓存**：如果权限配置表膨胀到数千条，可引入 Redis 缓存 `RolePermissions`，减少配置读取开销。
3. **前端权限指令**：当前前端权限控制依赖 `userInfo.role` 判断，可封装 `HasPermission` 组件或 `usePermission` Hook，统一管理按钮级别显隐。
4. **权限变更日志**：角色权限变更时记录 `SYSTEM:update_role` 操作日志，形成权限变更审计链。

---

### 相关文章

- [Customer Service Live Chat System](./customer-service-live-chat.md)
- [Order Management System](./order-management-system.md)
- [OTP & SMS Verification System](./otp-sms-verification-system.md)
- [OAuth Multi-Provider Authentication](./oauth-multi-provider-authentication.md)
- [Dashboard & Statistics System](./dashboard-statistics-system.md)
- [Prisma Database Architecture Design](./prisma-database-architecture.md)
