# OAuth 多供应商认证体系：Provider Strategy 模式与伪手机号生成

## 1. 架构全景

OAuth 多供应商认证是该平台用户体系的核心入口之一，支持 **Google、Facebook、Apple、GitHub** 四个标准 OAuth 供应商，以及 **Firebase 统一登录**（可代理 Google/Facebook/Apple 的 Firebase 端认证）。所有供应商共享同一个认证管线：

```
Client (App/Web)
  │
  ▼
┌──────────────────────────────────────────────────────────────┐
│  auth.controller.ts (5 OAuth POST endpoints)                 │
│  • POST /oauth/google    → GoogleOauthLoginDto               │
│  • POST /oauth/facebook  → FacebookOauthLoginDto             │
│  • POST /oauth/apple     → AppleOauthLoginDto                │
│  • POST /oauth/github    → GithubOauthLoginDto               │
│  • POST /firebase        → FirebaseLoginDto                  │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  Provider Strategy Pattern (5 providers)                     │
│  • GoogleProvider     ─ verify(idToken)                      │
│  • FacebookProvider   ─ verify({ accessToken, userId })      │
│  • AppleProvider      ─ verify(idToken)                      │
│  • GithubProvider     ─ verify(code) / verifyAccessToken()   │
│  • FirebaseProvider   ─ verifyIdToken(idToken)               │
│                                                              │
│  Output: VerifiedOauthProfile (标准化用户信息)                 │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  AuthService.loginWithOauth()                               │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Prisma.$transaction                               │     │
│  │  1. OauthAccount.findUnique (by provider + userId) │     │
│  │  2. If BOUND → login existing user                  │     │
│  │  3. If NEW → buildOauthPhone → user.upsert         │     │
│  │  4. upsertOauthAccount (always upsert)              │     │
│  │  5. writeOauthLoginLog                              │     │
│  └────────────────────────────────────────────────────┘     │
│                                                              │
│  Output: { tokens, id, phone, nickname, avatar, ... }       │
└──────────────────────────────────────────────────────────────┘
```

这种设计的核心优势在于：

1. **Provider Strategy 模式** — 每个供应商实现统一的 `verify()` 接口，输出标准化的 `VerifiedOauthProfile`，Controller 层无需关心验证细节
2. **事务化认证** — `loginWithOauth()` 在一个 Prisma `$transaction` 中完成 OAuth 记录查询、用户创建/更新、登录日志写入，保证原子性
3. **伪手机号隔离** — 非手机号注册的用户通过 `md5(provider:providerUserId)` 生成确定性伪手机号，确保不同供应商的账号不会冲突

---

## 2. Provider Strategy 模式

### 2.1 统一类型定义

[`provider.types.ts`](apps/api/src/client/auth/providers/provider.types.ts) 定义了所有供应商共享的标准化接口：

```typescript
export type OauthProvider = 'google' | 'facebook' | 'apple' | 'github';

export interface VerifiedOauthProfile {
  providerUserId: string;   // 供应商侧的用户唯一标识
  email?: string | null;    // 邮箱（可能为空）
  nickname?: string | null; // 昵称
  avatar?: string | null;   // 头像 URL
}
```

每个供应商的 Provider 类都返回这个标准结构，使得 `AuthService.loginWithOauth()` 可以统一处理所有供应商的认证结果。

### 2.2 OAUTH_PROVIDER_LIST 白名单

在 [`auth.service.ts`](apps/api/src/client/auth/auth.service.ts:40) 中维护了明确的供应商白名单：

```typescript
const OAUTH_PROVIDER_LIST: OauthProvider[] = [
  'google',
  'facebook',
  'apple',
  'github',
];
```

`loginWithOauth()` 入口处会校验传入的 provider 是否在白名单中：

```typescript
if (!OAUTH_PROVIDER_LIST.includes(provider)) {
  throw new BadRequestException('Invalid OAuth provider');
}
```

---

## 3. 各供应商 Provider 实现

### 3.1 GoogleProvider — 双路径验证

[`google.provider.ts`](apps/api/src/client/auth/providers/google.provider.ts) 实现了 **Firebase Admin SDK 优先 + Google oauth2 tokeninfo API 降级** 的双路径验证策略：

```typescript
async verify(idToken: string): Promise<VerifiedOauthProfile> {
  const token = idToken.trim();

  // 路径1：检查是否为 Firebase ID Token（JWT payload 中 iss 以 securetoken.google.com 开头）
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64').toString('utf-8'),
    );
    if (payload.iss?.startsWith('https://securetoken.google.com/')) {
      return await this.verifyFirebaseToken(token);
    }
  } catch {
    // JWT 解析失败，降级到 Google tokeninfo API
  }

  // 路径2：Google OAuth tokeninfo API 验证
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`,
  );
  // ...audience 验证、email_verified 检查
}
```

**双重路径设计的原因**：客户端可能使用 Firebase SDK 登录（返回 Firebase ID Token），也可能直接使用 Google OAuth SDK 登录（返回 Google ID Token）。两种 token 格式不同，需要不同的验证方式。

关键安全验证包括：

- **audience 验证** — 从环境变量 `GOOGLE_ALLOWED_CLIENT_IDS` 和 `GOOGLE_CLIENT_ID` 获取允许的 Client ID 列表，验证 token 的 `aud` 字段
- **email_verified 验证** — 拒绝未验证邮箱的 Google 账号
- **Base64/Base64url 兼容** — Firebase Admin SDK 初始化时处理了 Base64 编码、引号污染、换行转义等多种部署环境中的密钥格式问题

### 3.2 FacebookProvider — 三种验证方式

[`facebook.provider.ts`](apps/api/src/client/auth/providers/facebook.provider.ts) 支持三种 Facebook 登录场景：

**Access Token 验证**（Graph API）：

```typescript
private async verifyAccessToken(accessToken: string, userId: string) {
  const res = await fetch(
    `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${encodeURIComponent(accessToken)}`,
  );
  const data = await res.json() as FacebookProfileResponse;
  if (data.id !== userId) {
    throw new UnauthorizedException('Facebook user mismatch');
  }
  // 返回标准化 profile
}
```

**ID Token 验证**（JWT 本地解码）：

```typescript
private async verifyIdToken(idToken: string, userId: string) {
  const decoded = this.jwtService.decode(idToken);
  // 验证 aud (app ID)、sub (user ID)、exp (过期)
  if (this.facebookAppId && decoded.aud !== this.facebookAppId) {
    throw new UnauthorizedException('Facebook token audience mismatch');
  }
  // 可选：调用 Facebook debug_token API 进行额外验证
  await this.validateWithFacebookDebugToken(idToken);
}
```

**自动类型判断** — `verify()` 方法通过检查 token 是否包含 3 个 JWT 段（`accessToken.split('.').length === 3`）来自动判断是 Access Token 还是 ID Token。

### 3.3 AppleProvider — JWT 本地解析

[`apple.provider.ts`](apps/api/src/client/auth/providers/apple.provider.ts) 的实现最为简洁，因为 Apple 的 Sign In with Apple 返回的是标准 JWT，且 Apple 使用 JWKS（JSON Web Key Set）进行签名验证：

```typescript
async verify(idToken: string): Promise<VerifiedOauthProfile> {
  // 1. 解析 JWT payload（Base64url decode）
  const payload = await Promise.resolve(this.parseJwtPayload(token));

  // 2. 验证 subject
  const providerUserId = payload.sub?.trim();
  if (!providerUserId) throw new UnauthorizedException('Apple token missing subject');

  // 3. 验证过期时间
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new UnauthorizedException('Apple token expired');
  }

  // 4. 验证 audience（客户端 ID）
  const expectedAudience = this.configService.get<string>('APPLE_CLIENT_ID');
  if (payload.aud !== expectedAudience) {
    throw new UnauthorizedException('Apple token audience mismatch');
  }
}
```

> **注意**：Apple 不会返回用户的昵称和头像，因此返回的 `VerifiedOauthProfile` 中 `nickname` 和 `avatar` 固定为 `null`。

### 3.4 GithubProvider — 授权码交换 + 直接 Access Token

[`github.provider.ts`](apps/api/src/client/auth/providers/github.provider.ts) 支持两种登录模式：

**授权码模式**（`verify(code)`）：

```typescript
async verify(code: string): Promise<VerifiedOauthProfile> {
  // 1. GitHub API: POST /login/oauth/access_token → 获取 access_token
  const accessToken = await this.exchangeCodeForToken(code);

  // 2. GitHub API: GET /user → 获取用户信息
  const userInfo = await this.getUserInfo(accessToken);

  // 3. 标准化输出
  return this.normalizeUserInfo(userInfo);
}
```

**直接 Access Token 模式**（`verifyAccessToken(accessToken)`）：
适用于已在客户端获取到 GitHub Access Token 的场景，直接调用 `getUserInfo()` 获取用户信息。

`getUserInfo()` 中还包含邮箱补充逻辑：如果主用户信息中没有邮箱（GitHub 允许用户隐藏邮箱），则额外调用 `GET /user/emails` 查找首要且已验证的邮箱。

### 3.5 FirebaseProvider — 统一 ID Token 验证

[`firebase.provider.ts`](apps/api/src/client/auth/providers/firebase.provider.ts) 是 Firebase Admin SDK 的封装，但设计上与其他 Provider 不同——它返回 `provider` 和 `profile` 两个信息：

```typescript
async verifyIdToken(idToken: string): Promise<{
  provider: OauthProvider;    // 实际登录供应商（google/facebook/apple）
  profile: VerifiedOauthProfile;
}> {
  const decodedToken = await admin.auth().verifyIdToken(idToken);

  // 从 Firebase token 中提取实际使用的社交登录供应商
  const firebaseProvider = decodedToken.firebase?.sign_in_provider || 'unknown';
  let provider: OauthProvider = 'google';

  if (firebaseProvider.includes('google.com'))        provider = 'google';
  else if (firebaseProvider.includes('facebook.com'))  provider = 'facebook';
  else if (firebaseProvider.includes('apple.com'))     provider = 'apple';

  return {
    provider,
    profile: {
      providerUserId: decodedToken.uid,
      email: decodedToken.email || null,
      nickname: decodedToken.name || decodedToken.email?.split('@')[0] || null,
      avatar: decodedToken.picture || null,
    },
  };
}
```

这使得 Firebase 统一登录端点可以动态决定实际使用的供应商，并将正确的 `provider` 传递给 `loginWithOauth()`。

---

## 4. Controller 层：5 个 OAuth 端点

[`auth.controller.ts`](apps/api/src/client/auth/auth.controller.ts:107) 定义了 5 个 OAuth POST 端点，统一使用 `@Throttle({ otpRequest: { limit: 15, ttl: 60_000 } })` 进行速率限制：

| 端点 | DTO | Provider 调用 | 特殊处理 |
|------|-----|--------------|----------|
| `POST /oauth/google` | `GoogleOauthLoginDto` | `googleProvider.verify(idToken)` | 兼容 `idToken` 和 `credential` 字段（Web SDK vs Native SDK） |
| `POST /oauth/facebook` | `FacebookOauthLoginDto` | `facebookProvider.verify({ accessToken, userId })` | 兼容 `userId` 和 `userID` 字段 |
| `POST /oauth/apple` | `AppleOauthLoginDto` | `appleProvider.verify(idToken)` | 仅需 `idToken` |
| `POST /oauth/github` | `GithubOauthLoginDto` | `githubProvider.verify(code)` 或 `verifyAccessToken()` | 支持 `code` 和 `accessToken` 两种模式 |
| `POST /firebase` | `FirebaseLoginDto` | `firebaseProvider.verifyIdToken(idToken)` | 返回 provider + profile 双信息 |

所有端点共享相同的调用链：`Provider.verify()` → `AuthService.loginWithOauth()`，并将客户端的 IP、User-Agent、邀请码等信息透传给认证服务。

---

## 5. 核心事务：loginWithOauth()

[`auth.service.ts`](apps/api/src/client/auth/auth.service.ts:237) 中的 `loginWithOauth()` 是整个 OAuth 认证体系的核心，在一个 Prisma `$transaction` 中完成所有操作：

### 5.1 事务流程

```typescript
async loginWithOauth(provider, oauthProfile, meta?) {
  // ... 参数校验

  const user = await this.prisma.$transaction(async (ctx: AuthTx) => {
    // 步骤1：查询 OAuth 账号
    const oauthAccount = await ctx.oauthAccount.findUnique({
      where: { provider_providerUserId: { provider, providerUserId } },
    });

    // 步骤2：已绑定用户 → 直接登录
    if (oauthAccount && oauthAccount.bindStatus === BIND_STATUS.BOUND) {
      const existingUser = await ctx.user.findUnique({ where: { id: oauthAccount.userId } });
      // 更新最后登录时间
      await ctx.user.update({ where: { id: existingUserId }, data: { lastLoginAt: now } });
      // 更新 OAuth 账号信息
      await this.upsertOauthAccount(ctx, { ... });
      // 写登录日志
      await this.writeOauthLoginLog(ctx, resolvedUser.id, provider, meta, now);
      return existingUser;
    }

    // 步骤3：新用户 → 创建伪手机号 + 用户
    const pseudoPhone = this.buildOauthPhone(provider, providerUserId);
    const existingPseudoUser = await ctx.user.findUnique({ where: { phone: pseudoPhone } });

    const resolvedUser = existingPseudoUser
      ? await ctx.user.update({ ... })           // 复用已有伪用户
      : await ctx.user.create({ ... });           // 创建新伪用户

    // 步骤4：创建/更新 OAuth 账号绑定
    await this.upsertOauthAccount(ctx, { ... });

    // 步骤5：写登录日志
    await this.writeOauthLoginLog(ctx, resolvedUser.id, provider, meta, now);
    return resolvedUser;
  });

  // 步骤6：签发 JWT Token
  const tokens = await this.issueToken(user);
  return { tokens, id: user.id, phone: user.phone, ... };
}
```

### 5.2 关键设计细节

**用户信息保留策略** — 对于已存在的伪用户，更新时只在本地字段为空时才回填供应商资料：

```typescript
nickname: existingPseudoUser.nickname ?? normalizedNickname ?? undefined,
avatar: existingPseudoUser.avatar ?? normalizedAvatar ?? undefined,
```

这意味着如果用户在系统中手动修改了昵称或头像，即使再次通过 OAuth 登录也不会被覆盖。

**默认昵称生成** — 新用户如果没有昵称，使用 `ms_` + 随机后缀：

```typescript
nickname: normalizedNickname || `ms_${genRandomSuffix()}`,
```

---

## 6. 伪手机号生成策略

对于首次通过 OAuth 登录且没有手机号的用户，系统需要生成一个 **确定性伪手机号** 来满足 `User` 表的 `phone` 唯一约束。生成逻辑位于 [`auth.service.ts:374`](apps/api/src/client/auth/auth.service.ts:374)：

```typescript
private buildOauthPhone(provider: OauthProvider, providerUserId: string) {
  const digest = md5(`${provider}:${providerUserId}`);
  return `${provider}_${digest.slice(0, 10)}`;
}
```

**设计要点**：

| 原则 | 说明 |
|------|------|
| **确定性** | 同一供应商 + 同一用户 ID → 始终生成相同的伪手机号，保证幂等性 |
| **供应商隔离** | 前缀 `provider_` 确保不同供应商不会冲突（如 `google_xxx` ≠ `facebook_xxx`） |
| **短 MD5** | 只取 MD5 前 10 个字符，保持伪手机号长度可管理 |
| **不与真手机号冲突** | 伪手机号格式 `{provider}_{hex}`，真实手机号为纯数字，天然不冲突 |

伪手机号的 MD5 值也会同步存储到 `phoneMd5` 字段，供后续可能需要的脱敏查询使用。

---

## 7. 账号绑定 upsert

[`upsertOauthAccount`](apps/api/src/client/auth/auth.service.ts:379) 使用 Prisma 的 `upsert` 操作，通过 `@@unique([provider, providerUserId])` 唯一约束来确保每个供应商账号只绑定一个用户：

```typescript
private async upsertOauthAccount(tx, input) {
  await tx.oauthAccount.upsert({
    where: {
      provider_providerUserId: {
        provider: input.provider,
        providerUserId: input.providerUserId,
      },
    },
    create: {
      userId: input.userId,
      provider: input.provider,
      providerUserId: input.providerUserId,
      providerEmail: input.email?.trim() || null,
      providerNickname: input.nickname?.trim() || null,
      providerAvatar: input.avatar?.trim() || null,
      bindStatus: BIND_STATUS.BOUND,   // 1 = 已绑定
      firstBindAt: input.now,
      lastLoginAt: input.now,
    },
    update: {
      userId: input.userId,
      providerEmail: input.email?.trim() || null,
      providerNickname: input.nickname?.trim() || null,
      providerAvatar: input.avatar?.trim() || null,
      bindStatus: BIND_STATUS.BOUND,
      lastLoginAt: input.now,
    },
  });
}
```

> **注意**：这里的 `upsert` 是一个"创建或更新"操作——如果已存在记录，会更新其绑定信息至最新；如果不存在，则创建记录并设置 `firstBindAt`。`bindStatus` 在每次更新时都被设为 `BOUND`，这其实是重新确认绑定，在后续支持解绑/重新绑定功能时这个设计会更重要。

---

## 8. 数据模型

[`OauthAccount`](apps/api/prisma/schema.prisma:252) 模型完整结构：

```prisma
model OauthAccount {
  id               String    @id @default(cuid()) @map("oauth_id") @db.VarChar(32)
  userId           String    @map("user_id") @db.VarChar(32)
  createdAt        DateTime  @default(now()) @map("created_at")
  updatedAt        DateTime  @updatedAt @map("updated_at")
  provider         String    @map("provider") @db.VarChar(50)
  providerUserId   String    @map("provider_user_id") @db.VarChar(255)
  providerEmail    String?   @map("provider_email") @db.VarChar(255)
  providerNickname String?   @map("provider_nickname") @db.VarChar(100)
  providerAvatar   String?   @map("provider_avatar") @db.VarChar(255)
  accessToken      String?   @map("access_token")
  refreshToken     String?   @map("refresh_token")
  tokenExpiresAt   DateTime? @map("token_expires_at") @db.Timestamptz(3)
  bindStatus       Int       @default(1) @map("bind_status") @db.SmallInt
  firstBindAt      DateTime? @map("first_bind_at")
  lastLoginAt      DateTime? @map("last_login_at")
  user             User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerUserId], map: "uk_oauth_provider_user")
  @@index([userId], map: "idx_oauth_user")
  @@index([provider], map: "idx_oauth_provider")
  @@map("oauth_accounts")
}
```

关键约束和索引：

| 约束/索引 | 作用 |
|-----------|------|
| `@@unique([provider, providerUserId])` | 确保同一供应商的同一用户 ID 只绑定一次，是 upsert 操作的查找依据 |
| `@@index([userId])` | 支持按用户查询其绑定的所有 OAuth 账号 |
| `@@index([provider])` | 支持按供应商类型统计分析 |

---

## 9. 登录日志审计

每次 OAuth 登录都在 [`writeOauthLoginLog`](apps/api/src/client/auth/auth.service.ts:420) 中记录一条完整的审计记录：

```typescript
private async writeOauthLoginLog(tx, userId, provider, meta, now) {
  await tx.userLoginLog.create({
    data: {
      userId,
      loginType: LOGIN_TYPE.OAUTH,      // 标记为 OAuth 登录
      loginMethod: provider,             // 记录具体供应商（google/facebook/...）
      loginStatus: LOGIN_STATUS.SUCCESS,
      tokenIssued: TOKEN_ISSUED.YES,
      loginTime: now,
      loginIp: meta?.ip ?? null,
      userAgent: meta?.ua ?? null,
      countryCode: meta?.countryCode ? String(meta.countryCode) : null,
    },
  });
}
```

日志字段的设计满足了安全审计的完整需求：**谁**（userId）**何时**（loginTime）**通过什么方式**（loginType + loginMethod）**从哪个 IP**（loginIp）**登录了系统**。

---

## 10. 安全设计总结

| 安全层面 | 措施 |
|---------|------|
| **速率限制** | `@Throttle({ otpRequest: { limit: 15, ttl: 60_000 } })` — 每个端点每分钟最多 15 次请求 |
| **Token 验证** | Google 双重验证（Firebase Admin SDK + oauth2 API），Facebook audience + user ID 验证，Apple JWT 过期 + audience 验证 |
| **事务原子性** | `$transaction` 保证 OAuth 账号查询、用户创建/更新、日志写入要么全部成功，要么全部回滚 |
| **供应商白名单** | `OAUTH_PROVIDER_LIST` 硬编码白名单，拒绝未注册的供应商 |
| **伪手机号隔离** | `provider_md5[:10]` 格式确保不同供应商账号不会冲突，且不与真实手机号冲突 |
| **参数校验** | DTO 中使用 `class-validator` 的 `@IsNotEmpty`, `@IsString`, `@Length` 等装饰器进行输入校验 |
| **JWT 签发** | `loginWithOauth()` 最终调用 `issueToken()` 生成标准的 JWT Access Token + Refresh Token |

---

## 11. 总结

OAuth 多供应商认证体系通过 **Provider Strategy 模式** 实现了 5 种供应商登录方式的统一管理。核心设计亮点包括：

1. **标准化接口** — 每个 Provider 输出标准化的 `VerifiedOauthProfile`，`loginWithOauth()` 无需关心验证细节
2. **事务化认证管线** — 从 OAuth 记录查询到用户创建再到日志写入，全部在 `$transaction` 中原子执行
3. **双路径降级** — GoogleProvider 同时支持 Firebase Admin SDK 和 Google oauth2 API，兼顾安全性和兼容性
4. **确定性伪手机号** — `md5(provider:providerUserId)` 为新用户提供幂等的伪手机号，解决非手机号用户的标识问题
5. **完整的审计日志** — 每次 OAuth 登录都会记录详细的 `userLoginLog`，覆盖谁、何时、从哪登录
6. **多层安全防护** — 速率限制、Token 验证、事务原子性、供应商白名单、参数校验构成纵深防御
