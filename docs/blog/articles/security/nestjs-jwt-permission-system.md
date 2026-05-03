---
title: 'NestJS JWT + RBAC 权限系统实战：从开放接口到细粒度权限控制'
slug: nestjs-jwt-permission-system
description: 博客系统的管理接口从完全开放状态逐步演进到 JWT 认证 + RBAC 权限双层防护体系，涵盖 AdminJwtAuthGuard、PermissionsGuard、@RequirePermission 装饰器和 RolePermissions 配置的完整实现。
tags:
  - NestJS
  - JWT
  - Security
  - Authentication
  - RBAC
---

# NestJS JWT + RBAC 权限系统实战：从开放接口到细粒度权限控制

## 1. 前言：一个被忽视的安全漏洞

在博客系统的开发初期，所有管理接口都处于**完全开放**状态——无需任何认证即可调用文章的增删改查接口。

这意味着：

- 任何人都可以直接调用 `POST /admin/blog/articles` 创建文章
- 匿名用户可以删除全部文章和清空分类
- 没有任何操作审计，无法追踪谁做了什么
- 数据库可以被恶意清空

```
// ❌ 改造前：完全开放的控制器
@ApiTags('Admin Blog - Articles')
@Controller('admin/blog')
export class BlogController {
  @Delete(':id')
  async deleteArticle(@Param('id') id: string) {
    return this.blogService.deleteArticle(id);
    // 任何人都可以调用，没有任何校验
  }
}
```

这个问题的根源不是 NestJS 框架本身的安全缺陷，而是**安全架构在设计阶段没有被纳入强制规范**。本文记录了我们如何通过 JWT 认证 + RBAC 权限模型，为 4 个博客管理控制器构建完整的安全防线。

---

## 2. 安全架构概览

### 2.1 双层防护模型

系统的安全架构分为两层：

```
┌─────────────────────────────────────────────┐
│              HTTP Request                    │
│         Header: Bearer <token>               │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│          第一层：JWT Auth Guard               │
│                                              │
│  1. 提取 Bearer Token                        │
│  2. 验证 JWT 签名有效性                       │
│  3. 验证 Token 是否过期                       │
│  4. 解析用户身份并注入请求上下文                 │
│                                              │
│  失败 → 返回 401 Unauthorized                 │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│        第二层：Permissions Guard               │
│                                              │
│  1. 读取 @RequirePermission 元数据              │
│  2. 获取当前用户的 Role                        │
│  3. 查 RolePermissions 配置表                  │
│  4. 检查是否拥有所需权限                        │
│                                              │
│  无权限 → 返回 403 Forbidden                  │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│              Controller  Handler              │
│          ✅ 已认证、已授权，执行业务逻辑           │
└─────────────────────────────────────────────┘
```

### 2.2 认证层：AdminJwtAuthGuard

认证层负责验证请求者的身份。我们使用 `AdminJwtAuthGuard`，它强制校验请求头中的 Bearer Token：

```typescript
// apps/api/src/admin/auth/admin-jwt-auth.guard.ts
@Injectable()
export class AdminJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing authentication token');
    }

    try {
      // 验证 JWT 签名 & 过期时间
      const payload = this.jwtService.verify(token);
      // 将用户信息注入 request.user
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
```

关键设计点：

- **Token 提取**：从 `Authorization: Bearer <token>` 头中提取
- **签名验证**：使用 JWT Secret 验证签名，防止伪造
- **过期检查**：JWT 标准 `exp` 字段，自动过期
- **用户注入**：解析后的用户信息（含 role）注入到 `request.user`

### 2.3 权限层：PermissionsGuard

权限层在认证通过后执行，负责检查用户是否拥有执行特定操作的权限。

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

    // 没有标签 → 不需要特定权限，直接放行
    if (!requiredPermission) {
      return true;
    }

    // 2. 获取当前用户信息（JwtAuthGuard 已注入）
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const role = user?.role;

    if (!user || !role) {
      throw new UnauthorizedException('unauthorized');
    }

    // 3. 超级管理员跳过所有检查
    if (role === Role.SUPER_ADMIN) {
      return true;
    }

    // 4. 查权限配置表
    const userPermissions = RolePermissions[role] ?? [];
    const hasPermission = userPermissions.includes(requiredPermission);

    if (!hasPermission) {
      throw new ForbiddenException(`no permission: ${requiredPermission}`);
    }

    return true;
  }
}
```

---

## 3. 权限矩阵与 RBAC 设计

### 3.1 博客模块权限点

| 权限标识 | 模块 | 操作 | 接口范围 |
|----------|------|------|----------|
| `blog:view` | blog | view | 所有查询接口 |
| `blog:create` | blog | create | 创建接口 |
| `blog:update` | blog | update | 编辑、发布、审核接口 |
| `blog:delete` | blog | delete | 删除接口 |

### 3.2 角色权限体系

系统定义了 5 个角色，每个角色拥有不同的权限集合：

| 角色 | 标识 | 权限范围 |
|------|------|----------|
| 超级管理员 | `SUPER_ADMIN` | 所有权限，跳过权限检查 |
| 管理员 | `ADMIN` | 用户管理、订单管理、营销、财务只读、产品管理 |
| 编辑/运营 | `EDITOR` | 用户查看、营销管理（不含删除） |
| 观察者 | `VIEWER` | 只读权限：用户、订单、营销查看 |
| 财务专员 | `FINANCE` | 财务数据查看、提现/充值审核、报表导出 |

### 3.3 @RequirePermission 装饰器

权限通过装饰器声明在方法上，格式为 `模块:动作`：

```typescript
// apps/api/src/common/decorators/require-permission.decorator.ts
export const RequirePermission = (module: string, action: string) => {
  const permissionString = `${module}:${action}`;
  return SetMetadata(PERMISSION_KEY, permissionString);
};
```

### 3.4 RolePermissions 配置

权限配置集中管理在 `packages/shared/src/config/rbac.config.ts` 中：

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
    // ...更多模块权限
  ],
  [Role.EDITOR]: [
    `${OpModule.USER}:${OpAction.USER.VIEW}`,
    `${OpModule.MARKETING}:${OpAction.MARKETING.VIEW}`,
    `${OpModule.MARKETING}:${OpAction.MARKETING.CREATE}`,
    `${OpModule.MARKETING}:${OpAction.MARKETING.UPDATE}`,
    // 注意：没有 DELETE 权限
  ],
  // ...
};
```

---

## 4. 控制器集成：透明式安全改造

### 4.1 标准集成模板

每个博客管理控制器按照统一模式进行改造：

```typescript
@ApiTags('Admin Blog - XXX')
@ApiBearerAuth()
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
@Controller('admin/blog/xxx')
export class XxxController {

  @Get()
  @RequirePermission('blog', 'view')
  async list() { ... }

  @Post()
  @RequirePermission('blog', 'create')
  async create() { ... }

  @Put(':id')
  @RequirePermission('blog', 'update')
  async update() { ... }

  @Delete(':id')
  @RequirePermission('blog', 'delete')
  async delete() { ... }
}
```

### 4.2 已改造控制器

| 控制器 | 状态 | 完成时间 |
|--------|------|----------|
| ArticleController | ✅ 完成 | 2026-04-07 |
| CategoryController | ✅ 完成 | 2026-04-07 |
| TagController | ✅ 完成 | 2026-04-07 |
| CommentController | ✅ 完成 | 2026-04-07 |

### 4.3 实际代码示例：BlogController

```typescript
// apps/api/src/blog/blog.controller.ts
@ApiTags('Blog')
@Controller('admin/blog')
export class BlogController {

  @Get('articles')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '获取文章列表' })
  async getArticles(
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('status') status?: ArticleStatus,
    // ...
  ) {
    return this.blogService.getArticles({ page, pageSize, status });
  }

  @Post('articles')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '创建文章' })
  async createArticle(
    @Body() dto: CreateArticleDto,
    @CurrentUserId() userId: string,
  ) {
    return this.blogService.createArticle(dto, userId);
  }
}
```

---

## 5. 验收标准与测试

### 5.1 测试场景矩阵

| 测试场景 | 预期响应 | 验证状态 |
|----------|----------|----------|
| 未登录调用管理接口 | `401 Unauthorized` | ✅ 验证通过 |
| 登录但无权限调用 | `403 Forbidden` | ✅ 验证通过 |
| 登录且有权限调用 | `200 OK` | ✅ 验证通过 |
| Swagger 文档支持 Bearer 授权 | 显示授权按钮 | ✅ 验证通过 |
| 公开访问接口不受影响 | 正常可用 | ✅ 验证通过 |

### 5.2 使用 curl 验证认证流程

```bash
# ❌ 未登录调用 → 401
curl -X DELETE https://api.joyminis.com/admin/blog/articles/some-id
# → {"message":"Unauthorized","statusCode":401}

# ✅ 登录获取 Token
curl -X POST https://api.joyminis.com/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@joyminis.com","password":"***"}'
# → {"accessToken":"eyJhbGciOiJIUzI1NiIs...","user":{...}}

# ✅ 使用 Token 调用 → 200
curl -X GET https://api.joyminis.com/admin/blog/articles \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
# → {"data":[...],"meta":{...}}
```

---

## 6. 设计特点与最佳实践

### 6.1 透明式集成

- **类级别注解**：`@UseGuards(AdminJwtAuthGuard, PermissionsGuard)` 一次配置，整个控制器生效
- **零业务侵入**：安全逻辑完全独立于业务代码，无需修改 Service 层
- **向后兼容**：所有现有接口在添加安全层后行为不变（认证通过的情况下）

### 6.2 统一安全规范

- 所有 Admin 接口使用相同的安全架构
- 权限声明在控制器方法上清晰可见
- 便于代码审查：一眼就能看出每个接口需要的权限

### 6.3 可扩展设计

- **细粒度权限拆分**：支持后续将 `blog:view` 拆分为更细的 `blog:article_view`、`blog:category_view`
- **角色继承**：支持通过 RolePermissions 配置实现角色继承
- **动态权限**：支持从数据库动态加载权限配置

### 6.4 安全注意事项

```
✅ 应该做的：
  - JWT Secret 使用强随机字符串，通过环境变量注入
  - Token 设置合理的过期时间（建议 24h）
  - 使用 HTTPS 传输 Token
  - 定期轮换 JWT Secret

❌ 禁止做的：
  - 不要将 Token 存储在 localStorage（有 XSS 风险）
  - 不要将 JWT Secret 硬编码在代码中
  - 不要在前端日志中打印完整 Token
  - 不要使用过长的 Token 过期时间
```

---

## 7. 后续优化方向

### 7.1 细粒度权限拆分

| 计划权限 | 说明 |
|----------|------|
| `blog:category_manage` | 单独分类管理权限 |
| `blog:tag_manage` | 单独标签管理权限 |
| `blog:comment_moderate` | 评论审核专属权限 |

### 7.2 高级特性

1. **操作日志审计**：记录每次操作的用户、时间、IP、变更内容
2. **权限变更历史**：追踪权限变更记录，便于审计回溯
3. **临时授权机制**：支持按时间段授权，适合外包或临时管理员
4. **IP 白名单**：限制管理接口的访问 IP 范围

---

## 8. 总结

从"完全开放"到"双层防护"，这套 JWT + RBAC 权限系统为 4 个博客管理控制器构建了完整的安全防线：

- **认证层**（AdminJwtAuthGuard）确保每个请求都经过身份验证
- **权限层**（PermissionsGuard）确保每个操作都经过授权检查
- **装饰器模式**（@RequirePermission）让权限声明清晰、直观
- **集中配置**（RolePermissions）让权限管理统一、可维护

**实施时间**：2026-04-07
**状态**：✅ 已上线运行
**影响范围**：4 个控制器，16+ 个接口

---

*相关文档：*
- [博客系统后端架构总览](./architecture/nestjs-blog-backend-architecture.md)
- [Blog 认证系统文档索引](../../security/BLOG_AUTHENTICATION_INDEX.md)
- [API 认证集成指南](../../api/AUTHENTICATION_INTEGRATION_GUIDE.md)
