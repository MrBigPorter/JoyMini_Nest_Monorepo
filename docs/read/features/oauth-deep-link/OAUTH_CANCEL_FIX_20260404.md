# OAuth 取消/错误重定向修复 — 2026-04-04

## 🐛 问题描述

### 症状

用户点击 Facebook 登录后选择"取消"，浏览器返回到错误地址：

```
https://api.joyminis.com/oauth-error?code=PROVIDER_ERROR&provider=facebook&message=...#_=_
```

**预期行为：** 应该重定向到前端登录页 `https://admin.joyminis.com/login?cancelled=true`

---

## 🔍 根因分析

### 问题 1：完全不处理 `error` 参数

当用户点击"取消"，Facebook 回调：

```
GET /auth/facebook/callback?error=access_denied&error_reason=user_denied&state=xxx
```

**旧代码行为：**

```typescript
async facebookCallback(
  @Query('code') code: string,  // ← code = undefined
  @Query('state') state: string,
) {
  // 直接用 undefined code 调 Facebook Graph API
  const tokens = await this.exchangeFacebookCode(code); // ❌ 报错
  // ...
}
```

→ 抛出 `OAuthProviderError` → 进入 `handleOAuthError`

### 问题 2：错误重定向使用相对路径

```typescript
// 旧代码（错误）
private handleOAuthError(error: unknown, res: Response, provider: string) {
  if (error instanceof OAuthUserCancelledError) {
    return res.redirect(HttpStatus.FOUND, '/login?cancelled=true');
    //                                      ↑ 相对路径，在 API 服务器上解析为：
    //                                        https://api.joyminis.com/login
  }

  const errorUrl = `/oauth-error?code=${error.code}&...`;
  //                ↑ 相对路径 → https://api.joyminis.com/oauth-error
  return res.redirect(HttpStatus.FOUND, errorUrl);
}
```

### 问题 3：`#_=_` Fragment

这是 Facebook 老版 OAuth JS SDK 历史遗留行为，浏览器可能缓存追加。后端无法控制 URL fragment，前端需要在处理 OAuth 回调时过滤掉。

---

## ✅ 修复方案

### 1. `facebookCallback` & `googleCallback` 早检测 `error` 参数

```typescript
@Get('facebook/callback')
async facebookCallback(
  @Res() res: Response,
  @Query('code') code: string,
  @Query('state') state: string,
  @Query('error') error?: string,           // ← 新增
  @Query('error_reason') errorReason?: string, // ← 新增
) {
  // 用户取消授权：Facebook 返回 error=access_denied, error_reason=user_denied
  if (error || errorReason === 'user_denied') {
    this.logger.log(`Facebook OAuth cancelled/error: ${error}, reason: ${errorReason}`);
    const stateData = state ? this.decodeState(state) : null;
    return this.handleCancelledOAuth(res, stateData, 'facebook');
  }

  // 正常流程：code 存在时才换 token
  try {
    // ...
  }
}
```

同样修复 `googleCallback`（Google 取消时返回 `?error=access_denied`）

### 2. 新增 `handleCancelledOAuth` 方法

```typescript
/**
 * 处理用户主动取消 OAuth 授权的重定向逻辑
 * 优先级：移动端 Deep Link > Web redirectUri > 前端首页
 */
private handleCancelledOAuth(
  res: Response,
  stateData: OAuthStateData | null,
  provider: string,
) {
  this.logger.log(`User cancelled ${provider} OAuth, redirecting back`);

  // 1. 移动端 Deep Link 回调（App 调用）
  if (stateData?.callback) {
    try {
      const deepLink = new URL(stateData.callback);
      deepLink.searchParams.set('error', 'cancelled');
      deepLink.searchParams.set('provider', provider);
      return res.redirect(HttpStatus.FOUND, deepLink.toString());
      // 例：luna-app://oauth/callback?error=cancelled&provider=facebook
    } catch (_e) {
      this.logger.warn(`Invalid callback URL: ${stateData.callback}`);
    }
  }

  // 2. Web 端 redirectUri 回调（Web 登录流程）
  if (stateData?.redirectUri) {
    try {
      const webUrl = new URL(stateData.redirectUri);
      webUrl.searchParams.set('error', 'cancelled');
      webUrl.searchParams.set('provider', provider);
      return res.redirect(HttpStatus.FOUND, webUrl.toString());
    } catch (_e) {
      this.logger.warn(`Invalid redirectUri: ${stateData.redirectUri}`);
    }
  }

  // 3. Fallback：前端登录页（使用绝对 URL）
  const frontendUrl = this.configService.get<string>(
    'FRONTEND_URL',
    'http://localhost:5173',
  );
  return res.redirect(
    HttpStatus.FOUND,
    `${frontendUrl}/login?cancelled=true&provider=${provider}`,
  );
  // 生产：https://admin.joyminis.com/login?cancelled=true&provider=facebook
}
```

### 3. 修复 `handleOAuthError` 的所有重定向为绝对 URL

```typescript
private handleOAuthError(error: unknown, res: Response, provider: string) {
  if (error instanceof OAuthError) {
    // 用户取消登录
    if (error instanceof OAuthUserCancelledError) {
      return this.handleCancelledOAuth(res, null, provider);
    }

    // 其他错误，重定向到前端错误页面（绝对 URL）
    const frontendUrl = this.configService.get<string>(
      'FRONTEND_URL',
      'http://localhost:5173',
    );
    const errorUrl = `${frontendUrl}/oauth-error?code=${error.code}&provider=${provider}&message=${encodeURIComponent(userMessage)}`;
    //                 ↑ 使用 FRONTEND_URL 拼接绝对路径
    return res.redirect(HttpStatus.FOUND, errorUrl);
    // 生产：https://admin.joyminis.com/oauth-error?code=...
  }
  // ...
}
```

### 4. 修复 `.env.dev` 的 `FRONTEND_URL`

```diff
- FRONTEND_URL=http://localhost:5173
+ FRONTEND_URL=https://dev.joyminis.com
```

**`.env.prod` 已正确：**

```env
FRONTEND_URL=https://admin.joyminis.com
```

---

## 📋 部署检查清单

### 前置条件

- [x] 代码修复完成（`oauth-deeplink.controller.ts`）
- [x] `.env.dev` 配置更新
- [x] `.env.prod` 配置验证（已正确）
- [ ] 本地测试（开发环境）
- [ ] VPS 部署（生产环境）

### 测试场景

| 场景                  | 操作            | 预期结果                                                                     |
| --------------------- | --------------- | ---------------------------------------------------------------------------- |
| Facebook 取消（Web）  | 点击"取消"      | 重定向到 `https://admin.joyminis.com/login?cancelled=true&provider=facebook` |
| Google 取消（Web）    | 点击"取消"      | 重定向到 `https://admin.joyminis.com/login?cancelled=true&provider=google`   |
| Facebook 错误（网络） | 模拟网络错误    | 重定向到 `https://admin.joyminis.com/oauth-error?code=NETWORK_ERROR&...`     |
| 移动端 Deep Link      | App 调用 + 取消 | 重定向到 `luna-app://oauth/callback?error=cancelled&provider=facebook`       |

---

## 🚀 部署步骤

### 开发环境（VPS dev）

```bash
# 1. SSH 到 VPS
ssh root@your-vps-ip

# 2. 进入项目目录
cd /opt/lucky

# 3. 拉取最新代码
git pull origin main

# 4. 重启后端容器（Docker Compose）
docker compose --env-file deploy/.env.dev up -d backend

# 5. 验证日志
docker logs -f lucky-backend-dev --tail 100
```

### 生产环境（通过 CI/CD）

```bash
# 1. 确认代码已合并到 main 分支
git push origin main

# 2. GitHub Actions 自动触发构建
# - 镜像构建：ghcr.io/mrbigporter/lucky-backend-prod:latest
# - 自动推送到 GHCR

# 3. VPS 自动拉取新镜像（如果配置了 webhook）
# 或手动 SSH 到 VPS 执行：
ssh root@your-vps-ip
cd /opt/lucky
docker compose --env-file deploy/.env.prod pull backend
docker compose --env-file deploy/.env.prod up -d backend

# 4. 验证部署
curl -I https://api.joyminis.com/health
docker logs -f lucky-backend-prod --tail 50
```

---

## 📊 验证方法

### 1. 开发环境手动测试

```bash
# 模拟 Facebook 取消回调
curl -L -v "https://dev-api.joyminis.com/auth/facebook/callback?error=access_denied&error_reason=user_denied&state=xxx"

# 预期：302 重定向到 https://dev.joyminis.com/login?cancelled=true&provider=facebook
```

### 2. 生产环境监控

```bash
# 查看后端日志，确认取消事件被正确捕获
docker logs lucky-backend-prod --tail 100 | grep "cancelled"

# 示例输出：
# [OAuthDeepLinkController] Facebook OAuth cancelled/error: access_denied, reason: user_denied
# [OAuthDeepLinkController] User cancelled facebook OAuth, redirecting back
```

### 3. 前端集成验证

前端需要在 `/login` 页面处理 `?cancelled=true` 参数，显示友好提示：

```typescript
// apps/admin-next/src/app/login/page.tsx
const searchParams = useSearchParams();
const cancelled = searchParams.get("cancelled");
const provider = searchParams.get("provider");

if (cancelled === "true") {
  // 显示提示：「您已取消 {provider} 登录」
}
```

---

## 🛡️ 回滚方案

如果部署后出现问题，快速回滚：

```bash
# 1. SSH 到 VPS
ssh root@your-vps-ip

# 2. 回滚到上一个镜像版本
cd /opt/lucky
docker compose --env-file deploy/.env.prod down
docker pull ghcr.io/mrbigporter/lucky-backend-prod:previous-tag
docker compose --env-file deploy/.env.prod up -d backend

# 或使用 Git 回滚代码后重新构建
git revert <commit-hash>
git push origin main
# 等待 CI/CD 自动构建部署
```

---

## 📝 后续优化建议

1. **前端处理 `#_=_` fragment**  
   在 Web 登录页面移除 Facebook 追加的 `#_=_`：

   ```typescript
   // 清理 URL fragment
   if (window.location.hash === "#_=_") {
     window.history.replaceState(
       null,
       "",
       window.location.pathname + window.location.search,
     );
   }
   ```

2. **统一 OAuth 错误页面**  
   在 `apps/admin-next` 创建 `/oauth-error` 页面，展示用户友好的错误信息：

   ```typescript
   // apps/admin-next/src/app/oauth-error/page.tsx
   export default function OAuthErrorPage() {
     const searchParams = useSearchParams();
     const code = searchParams.get('code');
     const provider = searchParams.get('provider');
     const message = searchParams.get('message');

     return (
       <div>
         <h1>登录失败</h1>
         <p>{message}</p>
         <Button onClick={() => router.push('/login')}>返回登录</Button>
       </div>
     );
   }
   ```

3. **移动端 Deep Link 取消处理**  
   在 Flutter App 中监听 `error=cancelled` 参数：

   ```dart
   // lib/core/services/auth/deep_link_handler.dart
   if (uri.queryParameters['error'] == 'cancelled') {
     final provider = uri.queryParameters['provider'];
     showSnackBar('您已取消 $provider 登录');
     return;
   }
   ```

4. **监控 OAuth 取消率**  
   在后端日志中记录取消事件，定期分析：
   ```typescript
   this.logger.log(`[Analytics] OAuth cancelled: ${provider}`, {
     timestamp: Date.now(),
     provider,
     // 可选：记录到 Sentry / CloudWatch
   });
   ```

---

## 🔗 相关文档

- [OAuth Deep Link 技术规范](./BACKEND_OAUTH_DEEP_LINK_TECHNICAL_SPEC.md)
- [Flutter OAuth Deep Link 开发指南](./FLUTTER_OAUTH_DEEP_LINK_DEVELOPER_GUIDE.md)
- [OAuth 错误处理规范](../../common/oauth/oauth-errors.ts)
- [部署流程](../../../../RUNBOOK.md)
