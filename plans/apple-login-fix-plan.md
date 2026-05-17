# Apple 登录修复计划

## 现状总结

| 模块 | 状态 | 说明 |
|------|------|------|
| `apple.provider.ts` — Token 验证 | ✅ 完成 | JWT 解析 + sub/exp/aud 校验 |
| 单元测试 `apple.provider.spec.ts` | ✅ 完成 | 2 个测试用例 |
| `AuthController` POST `/auth/oauth/apple` | ✅ 完成 | 接收 idToken 直连登录（适合 Native SDK） |
| `AuthService.loginWithOauth()` | ✅ 完成 | 统一 OAuth 用户/账户关联逻辑 |
| `AppleOauthLoginDto` | ✅ 完成 | idToken required |
| `authApi.ts` 前端 `loginWithApple()` | ✅ 完成 | API 客户端已就绪 |
| `oauth-deeplink.controller.ts` — `generateAppleClientSecret()` | ❌ 硬编码占位符 | Deep Link 流程无法完成 |
| `page.client.tsx` — Apple 登录按钮 | ❌ 缺失 | 只有 Google + Facebook 按钮 |

---

## 修复步骤

### Step 1: 添加 `jsonwebtoken` 依赖

**文件**: [`apps/api/package.json`](apps/api/package.json)

- 运行 `yarn workspace @lucky/api add jsonwebtoken`
- 运行 `yarn workspace @lucky/api add -D @types/jsonwebtoken`

**原因**: Apple 的 `client_secret` 需要用 ES256 算法实时签发 JWT，`jsonwebtoken` 库支持该算法。

### Step 2: 添加环境变量 Joi 校验

**文件**: [`apps/api/src/app.module.ts`](apps/api/src/app.module.ts:59) — `validationSchema`

在 Joi 校验对象中新增 3 个 Apple 配置项：

```typescript
// Apple Sign In with Apple
APPLE_CLIENT_ID: Joi.string().required(),
APPLE_REDIRECT_URI: Joi.string().uri().required(),
APPLE_TEAM_ID: Joi.string().required(),
APPLE_KEY_ID: Joi.string().required(),
APPLE_PRIVATE_KEY: Joi.string().required(), // .p8 私钥内容
```

注意：`APPLE_CLIENT_ID` 和 `APPLE_REDIRECT_URI` 已有引用但未在 Joi 中声明，一并补上。

### Step 3: 实现 `generateAppleClientSecret()`

**文件**: [`apps/api/src/client/auth/oauth-deeplink.controller.ts`](apps/api/src/client/auth/oauth-deeplink.controller.ts:654)

将占位符方法替换为真实实现：

```typescript
private generateAppleClientSecret(): string {
  const teamId = this.configService.get<string>('APPLE_TEAM_ID');
  const keyId = this.configService.get<string>('APPLE_KEY_ID');
  const privateKey = this.configService.get<string>('APPLE_PRIVATE_KEY');

  if (!teamId || !keyId || !privateKey) {
    throw new OAuthProviderError(
      'Apple OAuth credentials not configured',
      'apple',
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const clientId = this.configService.get<string>('APPLE_CLIENT_ID');

  const headers = {
    algorithm: 'ES256' as const,
    keyid: keyId,
  };

  const claims = {
    iss: teamId,
    iat: now,
    exp: now + 60 * 60 * 24 * 30, // 30 天有效期
    aud: 'https://appleid.apple.com',
    sub: clientId,
  };

  return jwt.sign(claims, privateKey, headers);
}
```

需要在文件顶部 `import * as jwt from 'jsonwebtoken';`

**关键说明**:
- Apple 要求 `client_secret` 是一个由开发者签发的 JWT，不是静态字符串
- `.p8` 私钥从 Apple Developer → Certificates, Identifiers & Profiles → Keys 页面创建并下载
- 私钥只下载一次，必须安全保存
- JWT 有效期 Apple 建议最长 6 个月，这里设置为 30 天

### Step 4: 前端添加 Apple 登录按钮

**文件**: [`apps/frontend-blog/src/app/[locale]/login/page.client.tsx`](apps/frontend-blog/src/app/[locale]/login/page.client.tsx)

#### 4.1 添加 `handleAppleLoginClick()` 方法

在现有 `handleFacebookLoginClick()` 之后新增：

```typescript
// 处理Apple登录按钮点击 - 使用后端deep link endpoints
const handleAppleLoginClick = () => {
  try {
    setError(null);
    setIsOAuthLoading(true);

    const params = new URLSearchParams();

    // Web flow: redirect back to blog callback
    if (!isFromApp) {
      params.set('redirect_uri', `${window.location.origin}/oauth/callback`);
      params.set('state', generateWebState());
    }
    // App flow: use deep link callback
    else {
      if (callback) params.set('callback', callback);
      if (platform) params.set('platform', platform);
    }

    // 通用参数
    params.set('client', client || 'web');
    if (inviteCode) params.set('inviteCode', inviteCode);

    // 重定向到后端 OAuth 发起
    const oauthOrigin = process.env.NEXT_PUBLIC_OAUTH_API_ORIGIN || '';
    window.location.href = `${oauthOrigin}/auth/apple/login?${params.toString()}`;
  } catch (err: any) {
    setError(err.message || t('auth.oauth.appleFailed'));
    setIsOAuthLoading(false);
  }
};
```

#### 4.2 添加 Apple 登录按钮 JSX

在 Facebook 按钮后面新增：

```tsx
{/* Apple按钮 */}
<button
  onClick={handleAppleLoginClick}
  disabled={isOAuthLoading}
  className="w-full py-3 px-4 rounded-xl border border-border bg-background hover:bg-accent/50 transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
>
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"
      fill="currentColor"
    />
  </svg>
  {t('auth.login.apple')}
</button>
```

#### 4.3 确认 i18n 翻译键存在

需要确认以下翻译键在翻译文件中存在：

| 键 | 示例值 |
|---|--------|
| `auth.login.apple` | "Sign in with Apple" |
| `auth.oauth.appleFailed` | "Apple login failed, please try again" |

如果不存在，需在 [`apps/frontend-blog/src/i18n/`](apps/frontend-blog/src/i18n/) 下的翻译文件中添加。

---

## 执行顺序

```
Step 1: 安装 jsonwebtoken 依赖
    ↓
Step 2: 添加 Joi 环境变量校验
    ↓
Step 3: 实现 generateAppleClientSecret()
    ↓
Step 4: 前端添加 Apple 登录按钮 + 事件处理
```

## 验证清单

- [ ] `jsonwebtoken` 安装成功，编译无错误
- [ ] Joi 校验可识别 `APPLE_TEAM_ID` / `APPLE_KEY_ID` / `APPLE_PRIVATE_KEY`
- [ ] `generateAppleClientSecret()` 返回有效的 ES256 JWT（可在 jwt.io 验证）
- [ ] 前端登录页显示 Apple 登录按钮
- [ ] 点击 Apple 按钮正确跳转到 `GET /auth/apple/login`
- [ ] Apple 回调后成功返回 token 并登录
