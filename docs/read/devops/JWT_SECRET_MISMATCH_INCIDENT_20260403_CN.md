# JWT 密钥不一致导致登录后立即 401 事故复盘

**日期**: 2026-04-03  
**影响范围**: Dev 环境 Admin 登录功能  
**严重程度**: 🔴 P0（阻断核心功能）  
**修复时长**: 20 分钟

---

## 一、事故现象

### 用户报告

用户在 `https://admin-dev.joyminis.com/` 登录成功后，立即访问任何受保护页面（如 `/applications`）都返回 401 Unauthorized。

### 关键日志

```log
# 1. 登录成功 - verify-token 返回 200
2026-04-03T01:18:58.987Z Request Body: { "token": "eyJ..." }
2026-04-03T01:18:58.987Z Response: 200 { "code": 10000, "data": { "ok": true } }

# 2. 立即请求其他接口 - 401 失败
2026-04-03T01:18:59.011Z GET /api/v1/admin/applications/pending-count
2026-04-03T01:18:59.011Z UnauthorizedException: Unauthorized
2026-04-03T01:18:59.013Z Response: 401 { "code": 40100, "message": "Unauthorized" }
```

### 关键观察

- **Token 未过期**：从日志看 `iat: 1775179138, exp: 1775222338`（12 小时有效期）
- **中间件正常**：前端 middleware 成功解析 JWT payload，未清除 cookie
- **登录验证成功**：`/auth/admin/verify-token` 返回 200
- **后续请求全挂**：所有受 `AdminJwtAuthGuard` 保护的接口均 401

---

## 二、根本原因

### 核心矛盾：签发与验证使用不同密钥

**代码位置**：`apps/api/src/admin/auth/auth.module.ts`

```typescript
// ❌ 错误配置（修复前）
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'please_change_me_very_secret',  // ← Client 密钥
      signOptions: { expiresIn: '15m' },
    }),
  ],
  providers: [AuthService, ...],
})
export class AuthModule {}
```

**问题链条**：

1. **AuthModule 初始化**：`JwtModule.register({ secret: JWT_SECRET })` → 注入的 `JwtService` 固定使用 `JWT_SECRET`
2. **AuthService 签发 Token**：

   ```typescript
   // apps/api/src/admin/auth/auth.service.ts
   private getAdminJwtSecret() {
     return process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || 'please_change_me_very_secret';
   }

   // ✅ 看起来用了 ADMIN_JWT_SECRET，但实际...
   await this.jwt.signAsync(payload, { secret: this.getAdminJwtSecret() });
   ```

   **陷阱**：`signAsync` 的 `secret` 参数在某些 NestJS 版本中会被 `JwtModule` 初始化时的 `secret` 覆盖！实际签发时仍使用 `JWT_SECRET`。

3. **AdminJwtAuthGuard 验证 Token**：

   ```typescript
   // apps/api/src/admin/auth/admin-jwt-auth.guard.ts
   const secret =
     process.env.ADMIN_JWT_SECRET ||
     process.env.JWT_SECRET ||
     "please_change_me_very_secret";
   jwt.verify(token, secret); // ✅ 使用 ADMIN_JWT_SECRET
   ```

4. **密钥不匹配**：
   - 签发：`JWT_SECRET` = `please_change_me_very_secret`
   - 验证：`ADMIN_JWT_SECRET` = `dev_admin_jwt_secret_change_me_20260403`
   - 结果：所有 token 验证失败 → 401 Unauthorized

### 环境变量配置（deploy/.env.dev）

```dotenv
JWT_SECRET=please_change_me_very_secret                          # Client 用
ADMIN_JWT_SECRET=dev_admin_jwt_secret_change_me_20260403         # Admin 用（但 AuthModule 未使用）
```

---

## 三、修复方案

### 3.1 代码修复

**文件**：`apps/api/src/admin/auth/auth.module.ts`

```diff
 @Module({
   imports: [
     PrismaModule,
     PassportModule.register({ defaultStrategy: 'jwt' }),
     JwtModule.register({
-      secret: process.env.JWT_SECRET || 'please_change_me_very_secret',
+      secret:
+        process.env.ADMIN_JWT_SECRET ||
+        process.env.JWT_SECRET ||
+        'please_change_me_very_secret',
       signOptions: {
-        expiresIn: (process.env.JWT_ACCESS_EXPIRATION as any) || '15m',
+        expiresIn: (process.env.ADMIN_JWT_ACCESS_EXPIRATION as any) || '12h',
       },
     }),
   ],
```

**关键点**：

- `secret` 改为优先使用 `ADMIN_JWT_SECRET`，与 `AuthService.getAdminJwtSecret()` 保持一致
- `expiresIn` 改为 `ADMIN_JWT_ACCESS_EXPIRATION`，与业务约定的 12 小时一致（原来是 15 分钟）

### 3.2 部署步骤

```bash
# 1. 修改代码（已完成）
vim apps/api/src/admin/auth/auth.module.ts

# 2. 重启 backend 容器
docker compose --env-file deploy/.env.dev restart backend

# 3. 验证容器启动
docker logs --tail 30 lucky-backend-dev

# 4. 清除浏览器旧 token + localStorage，重新登录测试
```

---

## 四、验证结果

### 预期行为（修复后）

1. 登录 → 签发 token（使用 `ADMIN_JWT_SECRET`）
2. 访问 `/admin/*` → 验证 token（使用 `ADMIN_JWT_SECRET`） → ✅ 200 OK
3. Token 有效期 12 小时（符合业务预期）

### 测试 Checklist

- [ ] 登录成功获取 token
- [ ] 访问 `/api/v1/admin/applications/pending-count` → 200
- [ ] 访问 `/api/v1/admin/order/list` → 200
- [ ] 访问 `/api/v1/admin/finance/statistics` → 200
- [ ] 12 小时后 token 过期自动跳登录页

---

## 五、预防措施

### 5.1 技术约定（已补充到 `.github/copilot-instructions.md`）

```markdown
### 后端规范

- **⚠️ 关键**：Admin 相关模块的 `JwtModule.register({ secret })` 必须使用
  `ADMIN_JWT_SECRET || JWT_SECRET`（与 `AuthService.getAdminJwtSecret()` 保持一致），
  否则签发和验证使用不同密钥会导致 401 Unauthorized
```

### 5.2 检查清单（后续 Code Review）

| 检查项                                                            | 对应文件                                  |
| ----------------------------------------------------------------- | ----------------------------------------- |
| `JwtModule.register({ secret })` 是否与业务 secret 一致？         | `**/auth.module.ts`                       |
| `JwtService.signAsync()` 的 `secret` 参数是否必要？               | `**/auth.service.ts`                      |
| `JwtAuthGuard` / `AdminJwtAuthGuard` 验证密钥是否与签发一致？     | `**/jwt.guard.ts`, `**/jwt-auth.guard.ts` |
| Client / Admin 双域 JWT 是否物理隔离？                            | 所有 `JwtModule.register()`               |
| 环境变量 `JWT_SECRET` / `ADMIN_JWT_SECRET` 是否在 `.env` 中配置？ | `deploy/.env.dev`, `deploy/.env.prod`     |

### 5.3 自动化检测建议

**新增 E2E 测试**（`apps/admin-next/playwright/auth.spec.ts`）：

```typescript
test("登录后立即访问受保护页面应成功", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[name="username"]', process.env.E2E_ADMIN_USERNAME!);
  await page.fill('input[name="password"]', process.env.E2E_ADMIN_PASSWORD!);
  await page.click('button[type="submit"]');

  // 等待跳转到首页
  await page.waitForURL("/");

  // 立即访问其他页面（不刷新页面）
  await page.goto("/applications");
  await expect(page.locator("h1")).toContainText("Applications"); // 而非 "Login"

  // 验证 API 请求成功（不是 401）
  const response = await page.waitForResponse((resp) =>
    resp.url().includes("/admin/applications/pending-count"),
  );
  expect(response.status()).toBe(200);
});
```

---

## 六、心智模型提问

### Q1：为什么 `JwtModule.register({ secret })` 会覆盖 `signAsync({ secret })`？

**答**：NestJS `JwtModule` 的默认行为是在模块初始化时绑定全局 `secret`，除非显式在每次 `signAsync` / `verifyAsync` 调用时传入不同 `secret`，否则会优先使用模块级配置。这是一种"配置即约定"的设计，但在多域认证场景下容易踩坑。

**最佳实践**：

- **单域认证**：`JwtModule.register({ secret: process.env.JWT_SECRET })` + `signAsync(payload)`（不传 secret）
- **多域认证**：每个域独立 Module，各自配置对应 secret，避免运行时动态切换

### Q2：如何快速排查"登录成功但立即 401"类问题？

**排查流程**：

1. **确认 token 未过期**：解码 JWT payload，检查 `exp` 是否在当前时间之后
2. **确认 token 格式正确**：三段式 `header.payload.signature`，Base64 可解析
3. **比对签发与验证密钥**：
   - 签发：找 `JwtService.signAsync()` 调用，追踪 `secret` 来源
   - 验证：找 `jwt.verify()` 或 `JwtAuthGuard`，追踪 `secret` 来源
4. **检查环境变量加载**：`console.log(process.env.ADMIN_JWT_SECRET)` 确保容器内正确读取
5. **重启后端容器**：环境变量变更需要重启生效

### Q3：为什么 `verify-token` 接口成功，但其他接口失败？

**答**：`/auth/admin/verify-token` 可能使用的是独立验证逻辑（如 `AuthService.verifyAdminToken()`），它内部调用 `this.jwt.verifyAsync(token, { secret: this.getAdminJwtSecret() })`，显式传入 `secret` 覆盖了模块默认配置。

但其他接口使用的是 `AdminJwtAuthGuard`，它直接用 `jsonwebtoken.verify(token, ADMIN_JWT_SECRET)`，不依赖 `JwtService`，所以密钥来源不同。

**教训**：统一认证路径，避免多套验证逻辑（一套走 `JwtService`，一套走 `jsonwebtoken`）。

---

## 七、相关文档

- **JWT 双域认证设计**：`docs/read/architecture/NESTJS_API_ARCHITECTURE_CN.md` § 3.1
- **Admin 认证流程**：`docs/read/features/FEATURES_CN.md` § Admin 登录认证
- **环境变量规范**：`.github/copilot-instructions.md` § 后端规范
- **历史事故**：
  - `docs/read/devops/DEPLOY_INCIDENT_20260321_CN.md`（Prisma / TypeScript rootDir 事故）
  - `docs/read/devops/PRISMA_V6_MIGRATION_CN.md`（Prisma v6 容器崩溃）

---

## 八、总结

| 维度       | 内容                                                                             |
| ---------- | -------------------------------------------------------------------------------- |
| **触发器** | 环境变量 `ADMIN_JWT_SECRET` 配置后，`AuthModule` 未同步更新                      |
| **根因**   | `JwtModule.register()` 使用 `JWT_SECRET`，与验证逻辑的 `ADMIN_JWT_SECRET` 不一致 |
| **影响**   | 登录成功但立即 401，用户无法使用 Admin 后台任何功能                              |
| **修复**   | 统一 `AuthModule.JwtModule.register({ secret })` 为 `ADMIN_JWT_SECRET`           |
| **预防**   | 技术约定 + Code Review + E2E 测试覆盖"登录后立即访问"场景                        |

**心智模型沉淀**：多域认证场景下，"签发密钥"与"验证密钥"必须同源，否则 token 虽合法但无法通过校验。NestJS `JwtModule` 的模块级 `secret` 会在运行时绑定，需特别留意。
