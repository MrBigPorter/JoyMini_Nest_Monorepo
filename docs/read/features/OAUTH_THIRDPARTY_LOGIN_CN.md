# 客户端 API 第三方登录方案

> **文档状态**: 设计阶段（2026-03-19）  
> **目标**: 为客户端小程序/H5/Flutter App 添加 Google、Facebook、Apple 三方登录支持  
> **负责模块**: `apps/api/src/client/auth/` + 客户端前端（H5/Flutter）  
> **Flutter 适配结论**: ✅ 后端方案 100% 兼容 Flutter，无需改动任何接口

---

## 目录

1. [现状盘点](#一现状盘点)
2. [技术选型与原因](#二技术选型与原因)
3. [完整登录流程](#三完整登录流程)
4. [数据库层（已就绪）](#四数据库层已就绪)
5. [后端实现计划](#五后端实现计划)
6. [前端实现计划（客户端前端）](#六前端实现计划客户端前端)
7. [Flutter 适配分析](#七flutter-适配分析)
8. [环境变量清单](#八环境变量清单)
9. [安全清单](#九安全清单)
10. [测试策略](#十测试策略)
11. [实施 Checklist](#十一实施-checklist)
12. [学习掌握路径（必读文件与 API）](#十二学习掌握路径必读文件与-api)
13. [Lucky Draw 通知方案（拼团成功后）](#十三lucky-draw-通知方案拼团成功后)

---

## 一、现状盘点

### 已有基础（不需要重做）

| 层次                        | 状态    | 说明                                                  |
| --------------------------- | ------- | ----------------------------------------------------- |
| 数据库 `OauthAccount` 模型  | ✅ 已建 | 存 provider / providerUserId / email / avatar / token |
| 共享枚举 `PROVIDER`         | ✅ 已建 | `GOOGLE / FACEBOOK / APPLE`                           |
| 共享枚举 `LOGIN_METHOD`     | ✅ 已建 | `google / facebook / OTP / password`                  |
| 共享枚举 `LOGIN_TYPE.OAUTH` | ✅ 已建 | 值 = 3                                                |
| JWT 双 Token 体系           | ✅ 已建 | `accessToken 1h` + `refreshToken 7d`                  |
| `UserLoginLog` 表           | ✅ 已建 | loginType=3 即第三方登录                              |

### 当前缺口

| 缺口                                            | 影响                         |
| ----------------------------------------------- | ---------------------------- |
| 无 `POST /auth/oauth/:provider` 接口            | 前端无法发起三方登录         |
| 无 Google / Facebook / Apple token 验证 Service | 无法校验第三方令牌           |
| 无绑定/解绑接口                                 | 用户无法在设置页管理三方账号 |
| 前端无 Google/Facebook SDK 集成                 | 无法拉起授权弹窗             |

---

## 二、技术选型与原因

### 两种流程对比

```
方案 A — 服务端重定向流（Server-Side OAuth）
┌────────┐  1.点击登录  ┌──────────┐  2.重定向  ┌──────────────┐
│ 前端   │ ──────────→ │ 后端     │ ─────────→ │ Google/FB    │
│        │ ←────────── │ /oauth/  │ ←───────── │ 授权服务器   │
└────────┘  6.返回JWT   └──────────┘  5.code    └──────────────┘
                              ↓ 3.code→token
                         4.获取用户信息

方案 B — 客户端令牌流（Client-Side Token，本项目采用）
┌────────┐  1.Google/FB SDK  ┌──────────────┐
│ 前端   │ ────────────────→ │ Google/FB    │
│        │ ←──────────────── │ 授权服务器   │
│        │  2.id_token       └──────────────┘
│        │  3.POST /auth/oauth/google
│        │       { idToken }
└────────┘ ──────────────────→ ┌──────────┐
                                │ 后端     │  4.验证idToken
                ┌───────────────│          │ ──────────────→ Google
                │               └──────────┘ ←────────────── 用户信息
                │ 5.返回JWT                  6.upsert OauthAccount
                └────────────── 前端
```

### 为什么选方案 B？

| 维度               | 方案 A 服务端重定向                | 方案 B 客户端令牌（✅ 选）             |
| ------------------ | ---------------------------------- | -------------------------------------- |
| **适合小程序/SPA** | ❌ 重定向复杂，微信小程序不支持    | ✅ SDK 直接弹窗，体验流畅              |
| **部署复杂度**     | 需要公网回调 URL、HTTPS 证书       | 后端只需一个 POST 接口                 |
| **安全性**         | 服务端控制全流程                   | Google `id_token` 有签名，后端验证即可 |
| **开发工时**       | 高（OAuth 状态机/CSRF/code→token） | 低（一个 verify 接口）                 |
| **适用平台**       | Web 应用                           | Web + H5 + 小程序 ✅                   |

### 三方平台优先级（菲律宾市场）

| 平台         | 优先级 | 原因                                                      |
| ------------ | ------ | --------------------------------------------------------- |
| **Google**   | 🔴 P0  | Android 设备率高，Google 账号普及                         |
| **Facebook** | 🔴 P0  | 菲律宾 Facebook 用户渗透率全球最高（~97%）                |
| **Apple**    | 🟡 P1  | App Store 强制要求（有 Google/FB 登录就必须也支持 Apple） |

---

## 三、完整登录流程

### 3.1 Google 登录（id_token 验证）

```
前端                          后端                         Google
 │                             │                              │
 │ 1. 初始化 Google SDK         │                              │
 │    (google.accounts.id)      │                              │
 │                             │                              │
 │ 2. 用户点击"Google登录"按钮  │                              │
 │    → SDK 弹出 Google 弹窗    │                              │
 │                             │                              │
 │ 3. 用户授权 ──────────────────────────────────────────────→ │
 │ ←── 4. 返回 credential (id_token) ────────────────────────  │
 │                             │                              │
 │ 5. POST /auth/oauth/google  │                              │
 │    { idToken: "eyJ..." }    │                              │
 │ ──────────────────────────→ │                              │
 │                             │ 6. 调用 Google API 验证      │
 │                             │    tokeninfo?id_token=...    │
 │                             │ ──────────────────────────→  │
 │                             │ ←── 7. { sub, email, name }  │
 │                             │                              │
 │                             │ 8. prisma.oauthAccount.upsert│
 │                             │    (provider=google,         │
 │                             │     providerUserId=sub)      │
 │                             │                              │
 │                             │ 9. prisma.user.upsert        │
 │                             │    (登录即注册)              │
 │                             │                              │
 │                             │ 10. 写 UserLoginLog          │
 │                             │                              │
 │ ←── 11. { tokens, user }    │                              │
 │                             │                              │
 │ 12. 存储 accessToken        │                              │
 │     localStorage + Cookie    │                              │
```

### 3.2 Facebook 登录（accessToken 验证）

```
前端                          后端                         Facebook
 │                             │                              │
 │ 1. 初始化 FB.init()          │                              │
 │                             │                              │
 │ 2. FB.login() ─────────────────────────────────────────→   │
 │ ←── 3. { accessToken, userID }  ───────────────────────    │
 │                             │                              │
 │ 4. POST /auth/oauth/facebook │                              │
 │    { accessToken, userId }   │                              │
 │ ──────────────────────────→ │                              │
 │                             │ 5. 调用 Graph API 验证       │
 │                             │    /me?fields=id,name,email  │
 │                             │    Authorization: Bearer ... │
 │                             │ ──────────────────────────→  │
 │                             │ ←── 6. { id, name, email }   │
 │                             │                              │
 │                             │ 7. 验证 userId == id         │
 │                             │    （防止伪造 userId）        │
 │                             │                              │
 │                             │ 8-10. 同 Google 流程          │
 │ ←── 11. { tokens, user }    │                              │
```

### 3.3 Apple 登录（authorization_code 验证）

```
前端                          后端                         Apple
 │                             │                              │
 │ 1. AppleID.auth.signIn()    │                              │
 │    → 系统弹窗               │                              │
 │                             │                              │
 │ 2. 用户授权 ──────────────────────────────────────────────→ │
 │ ←── 3. { code,              │                              │
 │           id_token,         │                              │
 │           user(首次) }      │                              │
 │                             │                              │
 │ 4. POST /auth/oauth/apple   │                              │
 │    { code, idToken,         │                              │
 │      firstName, lastName }  │                              │
 │ ──────────────────────────→ │                              │
 │                             │ 5. 验证 id_token JWT         │
 │                             │    (Apple 公钥 JWKS)         │
 │                             │                              │
 │                             │ 6. 可选：用 code 换 token    │
 │                             │    POST /auth/token          │
 │                             │ ──────────────────────────→  │
 │                             │ ←── 7. token response        │
 │                             │                              │
 │                             │ 8-10. 同上                   │
 │ ←── 11. { tokens, user }    │                              │
```

> ⚠️ **Apple 特殊注意**: 用户信息（name/email）只在 **首次授权** 时返回，后续需从数据库读。

### 3.4 账号绑定逻辑（已有手机号用户的三方绑定）

```
用户情况                       处理逻辑
─────────────────────────────────────────────────────────────
全新用户（无手机号）           创建新 User + OauthAccount（登录即注册）
已有手机号的老用户             在"设置-账号安全"页手动绑定三方账号
三方账号已绑定其他用户         返回 409 Conflict 错误
用户解绑                       OauthAccount.bindStatus = 0（软删除）
```

---

## 四、数据库层（已就绪）

### `OauthAccount` 表（`schema.prisma` 已存在）

```prisma
model OauthAccount {
  id               String    @id @default(cuid())
  userId           String                         // → User.id
  provider         String    // "google" / "facebook" / "apple"
  providerUserId   String    // Google sub / FB id / Apple sub
  providerEmail    String?
  providerNickname String?
  providerAvatar   String?
  accessToken      String?   // 存储三方 access token（加密存储更佳）
  refreshToken     String?
  tokenExpiresAt   DateTime?
  bindStatus       Int       @default(1)  // 1=绑定 0=解绑
  firstBindAt      DateTime?
  lastLoginAt      DateTime?
  user             User      @relation(...)

  @@unique([provider, providerUserId])   // 关键唯一约束
  @@map("oauth_accounts")
}
```

### 不需要 migrate — 表已存在

```bash
# 验证表是否存在
npx prisma studio  # 在 OauthAccount 表查看即可
```

---

## 五、后端实现计划

### 5.1 目录结构（新增文件）

```
apps/api/src/client/auth/
├── auth.controller.ts          ← 新增 oauth 路由
├── auth.service.ts             ← 新增 loginWithOauth() 方法
├── auth.module.ts              ← 引入 HttpModule
├── providers/                  ← 新建目录
│   ├── google.provider.ts      ← 验证 Google id_token
│   ├── facebook.provider.ts    ← 验证 Facebook accessToken
│   └── apple.provider.ts       ← 验证 Apple id_token
└── dto/
    └── oauth-login.dto.ts      ← 新增 DTO
```

### 5.2 新增接口

```
POST /auth/oauth/google
POST /auth/oauth/facebook
POST /auth/oauth/apple

（已登录用户）
POST /auth/oauth/bind/:provider      ← 绑定三方账号
DELETE /auth/oauth/unbind/:provider  ← 解绑
GET  /auth/oauth/accounts            ← 查看已绑定的三方账号
```

### 5.3 `OauthLoginDto`

```typescript
// apps/api/src/client/auth/dto/oauth-login.dto.ts
import { IsString, IsNotEmpty, IsOptional } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class GoogleLoginDto {
  @ApiProperty({ description: "Google id_token (JWT)" })
  @IsString()
  @IsNotEmpty()
  idToken!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  inviteCode?: string;
}

export class FacebookLoginDto {
  @ApiProperty({ description: "Facebook access_token" })
  @IsString()
  @IsNotEmpty()
  accessToken!: string;

  @ApiProperty({ description: "Facebook user ID (防止伪造)" })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  inviteCode?: string;
}

export class AppleLoginDto {
  @ApiProperty({ description: "Apple authorization code" })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty({ description: "Apple id_token (JWT)" })
  @IsString()
  @IsNotEmpty()
  idToken!: string;

  @ApiPropertyOptional({ description: "首次授权时 Apple 返回的名字" })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  inviteCode?: string;
}
```

### 5.4 Google Provider（核心实现）

```typescript
// apps/api/src/client/auth/providers/google.provider.ts
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface GoogleUserInfo {
  sub: string; // Google 用户唯一 ID
  email: string;
  name: string;
  picture: string;
  email_verified: boolean;
}

@Injectable()
export class GoogleProvider {
  constructor(private readonly config: ConfigService) {}

  async verifyIdToken(idToken: string): Promise<GoogleUserInfo> {
    // 方案1: 调用 Google tokeninfo endpoint（简单，有网络开销）
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`,
    );

    if (!res.ok) {
      throw new UnauthorizedException("Google token verification failed");
    }

    const data = await res.json();

    // 验证 audience（防止其他应用的 token 被滥用）
    const clientId = this.config.get<string>("GOOGLE_CLIENT_ID");
    if (data.aud !== clientId) {
      throw new UnauthorizedException("Google token audience mismatch");
    }

    if (!data.email_verified) {
      throw new UnauthorizedException("Google email not verified");
    }

    return {
      sub: data.sub,
      email: data.email,
      name: data.name,
      picture: data.picture,
      email_verified: data.email_verified,
    };
  }
}
```

> **进阶方案**: 使用 `google-auth-library` npm 包，本地用 Google 公钥验证签名，无网络延迟：
>
> ```bash
> yarn workspace @lucky/api add google-auth-library
> ```
>
> ```typescript
> import { OAuth2Client } from "google-auth-library";
> const client = new OAuth2Client(clientId);
> const ticket = await client.verifyIdToken({ idToken, audience: clientId });
> const payload = ticket.getPayload();
> ```

### 5.5 Facebook Provider

```typescript
// apps/api/src/client/auth/providers/facebook.provider.ts
import { Injectable, UnauthorizedException } from "@nestjs/common";

export interface FacebookUserInfo {
  id: string;
  name: string;
  email?: string; // 用户可能不授权 email
  picture?: { data: { url: string } };
}

@Injectable()
export class FacebookProvider {
  async verifyAccessToken(
    accessToken: string,
    userId: string,
  ): Promise<FacebookUserInfo> {
    const fields = "id,name,email,picture";
    const url = `https://graph.facebook.com/me?fields=${fields}&access_token=${accessToken}`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new UnauthorizedException("Facebook token verification failed");
    }

    const data: FacebookUserInfo = await res.json();

    // 关键：比对 userId，防止 A 的 token 伪造 B 的登录
    if (data.id !== userId) {
      throw new UnauthorizedException("Facebook userId mismatch");
    }

    return data;
  }
}
```

### 5.6 Apple Provider

```typescript
// apps/api/src/client/auth/providers/apple.provider.ts
// Apple 使用 JWT + JWKS 验证，需要 jsonwebtoken + jwks-rsa
// yarn workspace @lucky/api add jsonwebtoken jwks-rsa
// yarn workspace @lucky/api add -D @types/jsonwebtoken

import { Injectable, UnauthorizedException } from "@nestjs/common";
import * as jwt from "jsonwebtoken";
import jwksRsa from "jwks-rsa";

export interface AppleUserInfo {
  sub: string; // Apple 用户唯一 ID（稳定不变）
  email?: string;
  email_verified?: boolean;
}

const jwksClient = jwksRsa({
  jwksUri: "https://appleid.apple.com/auth/keys",
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 24 * 60 * 60 * 1000, // 24h
});

@Injectable()
export class AppleProvider {
  async verifyIdToken(
    idToken: string,
    clientId: string,
  ): Promise<AppleUserInfo> {
    // 1. 解码 header，取 kid
    const decoded = jwt.decode(idToken, { complete: true });
    if (!decoded || typeof decoded === "string") {
      throw new UnauthorizedException("Invalid Apple id_token format");
    }

    const kid = decoded.header.kid;
    const key = await jwksClient.getSigningKey(kid);
    const publicKey = key.getPublicKey();

    try {
      const payload = jwt.verify(idToken, publicKey, {
        algorithms: ["RS256"],
        audience: clientId, // 你的 Apple Service ID 或 Bundle ID
        issuer: "https://appleid.apple.com",
      }) as AppleUserInfo;

      return payload;
    } catch (e) {
      throw new UnauthorizedException("Apple id_token verification failed");
    }
  }
}
```

### 5.7 `AuthService.loginWithOauth()` 核心方法

```typescript
// 新增到 auth.service.ts
async loginWithOauth(
  provider: 'google' | 'facebook' | 'apple',
  oauthUser: {
    providerUserId: string;
    email?: string;
    nickname?: string;
    avatar?: string;
  },
  meta?: { ip?: string; ua?: string; inviteCode?: string },
) {
  const now = new Date();

  const result = await this.prisma.$transaction(async (ctx) => {
    // 1. 查找已绑定的 OauthAccount
    let oauthAccount = await ctx.oauthAccount.findUnique({
      where: {
        provider_providerUserId: {  // @@unique([provider, providerUserId])
          provider,
          providerUserId: oauthUser.providerUserId,
        },
      },
      include: { user: true },
    });

    let user: User;

    if (oauthAccount && oauthAccount.bindStatus === BIND_STATUS.BOUND) {
      // 情况1: 老用户，直接取关联 User
      user = oauthAccount.user;

      // 更新 oauth 账号信息（昵称/头像可能有变化）
      await ctx.oauthAccount.update({
        where: { id: oauthAccount.id },
        data: {
          providerEmail: oauthUser.email,
          providerNickname: oauthUser.nickname,
          providerAvatar: oauthUser.avatar,
          lastLoginAt: now,
        },
      });
    } else {
      // 情况2: 全新三方用户，登录即注册
      const randomSuffix = genRandomSuffix();

      // 注意：三方登录用户可能没有手机号，phone 字段允许有临时占位
      // 方案：phone 设为 `oauth_${provider}_${providerUserId}` 的 MD5 前缀
      const pseudoPhone = `oauth_${md5(oauthUser.providerUserId).slice(0, 16)}`;

      user = await ctx.user.upsert({
        where: { phone: pseudoPhone },
        create: {
          phone: pseudoPhone,
          phoneMd5: md5(pseudoPhone),
          nickname: oauthUser.nickname ?? `ms_${randomSuffix}`,
          avatar: oauthUser.avatar ?? null,
          lastLoginAt: now,
        },
        update: { lastLoginAt: now },
        select: { id: true, nickname: true, avatar: true, phoneMd5: true,
                  phone: true, inviteCode: true, vipLevel: true,
                  kycStatus: true, selfExclusionExpireAt: true },
      });

      // 创建 OauthAccount 绑定
      await ctx.oauthAccount.upsert({
        where: {
          provider_providerUserId: {
            provider,
            providerUserId: oauthUser.providerUserId,
          },
        },
        create: {
          userId: user.id,
          provider,
          providerUserId: oauthUser.providerUserId,
          providerEmail: oauthUser.email,
          providerNickname: oauthUser.nickname,
          providerAvatar: oauthUser.avatar,
          bindStatus: BIND_STATUS.BOUND,
          firstBindAt: now,
          lastLoginAt: now,
        },
        update: {
          bindStatus: BIND_STATUS.BOUND,
          providerEmail: oauthUser.email,
          lastLoginAt: now,
        },
      });
    }

    // 3. 写登录日志
    await ctx.userLoginLog.create({
      data: {
        userId: user.id,
        loginType: LOGIN_TYPE.OAUTH,
        loginMethod: LOGIN_METHOD[provider.toUpperCase() as 'GOOGLE'],
        loginStatus: LOGIN_STATUS.SUCCESS,
        tokenIssued: TOKEN_ISSUED.YES,
        loginTime: now,
        loginIp: meta?.ip ?? null,
        userAgent: meta?.ua ?? null,
      },
    });

    return user;
  });

  const tokens = await this.issueToken(result);

  return {
    tokens,
    id: result.id,
    phone: result.phone,
    nickname: result.nickname,
    avatar: result.avatar,
    provider,
  };
}
```

### 5.8 Controller 新增路由

```typescript
// auth.controller.ts 新增

@Post('oauth/google')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@ApiOperation({ summary: 'Google 第三方登录' })
@HttpCode(HttpStatus.OK)
async loginWithGoogle(
  @Body() dto: GoogleLoginDto,
  @CurrentDevice() device: DeviceInfo,
) {
  const userInfo = await this.googleProvider.verifyIdToken(dto.idToken);
  return this.auth.loginWithOauth('google', {
    providerUserId: userInfo.sub,
    email: userInfo.email,
    nickname: userInfo.name,
    avatar: userInfo.picture,
  }, { ip: device.ip, ua: device.userAgent, inviteCode: dto.inviteCode });
}

@Post('oauth/facebook')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@ApiOperation({ summary: 'Facebook 第三方登录' })
@HttpCode(HttpStatus.OK)
async loginWithFacebook(
  @Body() dto: FacebookLoginDto,
  @CurrentDevice() device: DeviceInfo,
) {
  const userInfo = await this.facebookProvider.verifyAccessToken(
    dto.accessToken,
    dto.userId,
  );
  return this.auth.loginWithOauth('facebook', {
    providerUserId: userInfo.id,
    email: userInfo.email,
    nickname: userInfo.name,
    avatar: userInfo.picture?.data?.url,
  }, { ip: device.ip, ua: device.userAgent });
}

@Post('oauth/apple')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@ApiOperation({ summary: 'Apple 第三方登录' })
@HttpCode(HttpStatus.OK)
async loginWithApple(
  @Body() dto: AppleLoginDto,
  @CurrentDevice() device: DeviceInfo,
) {
  const clientId = this.config.get<string>('APPLE_CLIENT_ID')!;
  const userInfo = await this.appleProvider.verifyIdToken(dto.idToken, clientId);

  const nickname = dto.firstName
    ? `${dto.firstName} ${dto.lastName ?? ''}`.trim()
    : undefined;

  return this.auth.loginWithOauth('apple', {
    providerUserId: userInfo.sub,
    email: userInfo.email,
    nickname,
  }, { ip: device.ip, ua: device.userAgent });
}
```

---

## 六、前端实现计划（客户端前端）

> 目标端: 客户端前端（H5/Flutter，以下 Web 示例仅用于 API 联调参考）

### 6.1 Google 登录集成

```html
<!-- index.html 引入 Google SDK -->
<script src="https://accounts.google.com/gsi/client" async></script>
```

```typescript
// src/composables/useGoogleLogin.ts
import { useAuthStore } from "@/store/useAuthStore";

export function useGoogleLogin() {
  const authStore = useAuthStore();

  function initGoogle() {
    window.google.accounts.id.initialize({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      callback: handleCredentialResponse,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
  }

  async function handleCredentialResponse(response: { credential: string }) {
    try {
      const result = await authApi.loginWithGoogle({
        idToken: response.credential,
      });
      authStore.login(result.tokens.accessToken);
      // 跳转首页
    } catch (err) {
      console.error("Google login failed", err);
    }
  }

  function prompt() {
    window.google.accounts.id.prompt();
  }

  return { initGoogle, prompt };
}
```

### 6.2 Facebook 登录集成

```html
<!-- index.html -->
<script>
  window.fbAsyncInit = function () {
    FB.init({
      appId: "{{VITE_FACEBOOK_APP_ID}}",
      cookie: true,
      xfbml: true,
      version: "v19.0",
    });
  };
</script>
<script async defer src="https://connect.facebook.net/en_US/sdk.js"></script>
```

```typescript
// src/composables/useFacebookLogin.ts
export function useFacebookLogin() {
  function login() {
    return new Promise<void>((resolve, reject) => {
      FB.login(
        async (response) => {
          if (response.status === "connected") {
            const { accessToken, userID } = response.authResponse;
            try {
              const result = await authApi.loginWithFacebook({
                accessToken,
                userId: userID,
              });
              authStore.login(result.tokens.accessToken);
              resolve();
            } catch (err) {
              reject(err);
            }
          } else {
            reject(new Error("Facebook login cancelled"));
          }
        },
        { scope: "email" },
      );
    });
  }

  return { login };
}
```

### 6.3 Apple 登录集成（Web）

```html
<!-- index.html -->
<script
  type="text/javascript"
  src="https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js"
></script>
```

```typescript
// src/composables/useAppleLogin.ts
export function useAppleLogin() {
  function init() {
    AppleID.auth.init({
      clientId: import.meta.env.VITE_APPLE_CLIENT_ID, // Service ID
      scope: "name email",
      redirectURI: import.meta.env.VITE_APPLE_REDIRECT_URI, // 必须是 HTTPS
      usePopup: true, // 弹窗模式
    });
  }

  async function login() {
    const response = await AppleID.auth.signIn();
    const { code, id_token } = response.authorization;
    const name = response.user?.name; // 仅首次出现

    return authApi.loginWithApple({
      code,
      idToken: id_token,
      firstName: name?.firstName,
      lastName: name?.lastName,
    });
  }

  return { init, login };
}
```

### 6.4 API 调用封装

```typescript
// 客户端 Web 项目 src/api/index.ts 新增

export const authApi = {
  // ...现有方法...

  loginWithGoogle: (data: { idToken: string; inviteCode?: string }) =>
    http.post<LoginResponse>("/auth/oauth/google", data),

  loginWithFacebook: (data: { accessToken: string; userId: string }) =>
    http.post<LoginResponse>("/auth/oauth/facebook", data),

  loginWithApple: (data: {
    code: string;
    idToken: string;
    firstName?: string;
    lastName?: string;
  }) => http.post<LoginResponse>("/auth/oauth/apple", data),
};
```

### 6.5 登录页面 UI

```vue
<!-- Login.vue 三方登录按钮区域 -->
<template>
  <div class="oauth-buttons">
    <!-- 手机 OTP 登录（现有） -->
    <button @click="handleOtpLogin">手机号登录</button>

    <div class="divider">或</div>

    <!-- Google -->
    <button class="oauth-btn google" @click="googleLogin.prompt()">
      <GoogleIcon />
      使用 Google 登录
    </button>

    <!-- Facebook -->
    <button class="oauth-btn facebook" @click="fbLogin.login()">
      <FacebookIcon />
      使用 Facebook 登录
    </button>

    <!-- Apple（仅 iOS/macOS Safari 显示） -->
    <button
      v-if="isAppleDevice"
      class="oauth-btn apple"
      @click="appleLogin.login()"
    >
      <AppleIcon />
      使用 Apple 登录
    </button>
  </div>
</template>
```

---

## 七、Flutter 适配分析

### 7.1 核心结论：后端 0 改动，Flutter 原生更优

> **本方案选择的「客户端令牌流」天然适配 Flutter。**  
> Flutter 的三方登录插件在移动端直接调用系统原生 SDK，返回的就是 `idToken` / `accessToken`，  
> 与本方案后端接口的入参格式**完全一致**，无需新增任何接口。

```
┌──────────────────────────────────────────────────────────────┐
│                Vue 3 Web         Flutter Mobile               │
│                                                               │
│  Google SDK ─── id_token ──┐    google_sign_in ─── id_token ─┤
│  FB JS SDK ─── accessToken ┼──→ POST /auth/oauth/:provider   │
│  Apple JS ──── id_token ───┘    flutter_facebook_auth ───────┤
│                                 sign_in_with_apple ──────────┤
│                                                               │
│              ↑ 后端接口完全相同，无需区分平台 ↑              │
└──────────────────────────────────────────────────────────────┘
```

### 7.2 Flutter vs Vue 3 对比

| 维度              | Vue 3 Web                        | Flutter Mobile                   | 差异说明                       |
| ----------------- | -------------------------------- | -------------------------------- | ------------------------------ |
| **Google 登录**   | 浏览器 GSI SDK（JS）             | `google_sign_in` 包（原生）      | Flutter 更流畅，系统账号选择器 |
| **Facebook 登录** | FB JS SDK                        | `flutter_facebook_auth` 包       | 均可获取 accessToken           |
| **Apple 登录**    | `AppleID.auth.js`（Safari 限定） | `sign_in_with_apple` 包          | Flutter 在 iOS 上是原生体验    |
| **idToken 格式**  | JWT 字符串                       | JWT 字符串（相同）               | ✅ 后端无需区分                |
| **token 存储**    | `localStorage`                   | `flutter_secure_storage`（加密） | Flutter **更安全**             |
| **后端接口**      | `POST /auth/oauth/google` 等     | **完全相同**                     | ✅ 无需新增接口                |
| **平台配置**      | HTML `<script>` 引入             | `pubspec.yaml` + 原生配置文件    | 各有配置，互不影响             |
| **Apple 限制**    | 仅 Safari 支持                   | iOS/macOS 原生支持               | Flutter 体验更好               |

### 7.3 Flutter 三方登录插件选型

| 平台            | 推荐插件                         | pub.dev 评分 | 说明                       |
| --------------- | -------------------------------- | ------------ | -------------------------- |
| **Google**      | `google_sign_in: ^6.2.0`         | ⭐ 140 likes | Google 官方维护            |
| **Facebook**    | `flutter_facebook_auth: ^7.0.0`  | ⭐ 高        | 支持 iOS/Android/Web       |
| **Apple**       | `sign_in_with_apple: ^6.1.0`     | ⭐ 高        | 支持 iOS/macOS/Android/Web |
| **Token 存储**  | `flutter_secure_storage: ^9.0.0` | ⭐ 高        | Keychain/Keystore 加密存储 |
| **HTTP 客户端** | `dio: ^5.0.0`                    | ⭐ 高        | 功能完整，支持拦截器       |

### 7.4 Flutter 端实现代码

#### `pubspec.yaml` 依赖

```yaml
dependencies:
  google_sign_in: ^6.2.0
  flutter_facebook_auth: ^7.0.0
  sign_in_with_apple: ^6.1.0
  flutter_secure_storage: ^9.0.0
  dio: ^5.4.0
```

#### Google 登录（Flutter）

```dart
// lib/services/auth/google_auth_service.dart
import 'package:google_sign_in/google_sign_in.dart';

class GoogleAuthService {
  final GoogleSignIn _googleSignIn = GoogleSignIn(
    scopes: ['email', 'profile'],
    // clientId 仅 iOS/Web 需要显式指定，Android 用 google-services.json
    clientId: const String.fromEnvironment('GOOGLE_CLIENT_ID'),
  );

  Future<Map<String, dynamic>?> signIn() async {
    try {
      final account = await _googleSignIn.signIn();
      if (account == null) return null;  // 用户取消

      // 获取 id_token（关键步骤）
      final auth = await account.authentication;
      final idToken = auth.idToken;

      if (idToken == null) throw Exception('Google idToken is null');

      // 发送给后端验证
      return {'idToken': idToken};
    } catch (e) {
      rethrow;
    }
  }

  Future<void> signOut() => _googleSignIn.signOut();
}
```

#### Facebook 登录（Flutter）

```dart
// lib/services/auth/facebook_auth_service.dart
import 'package:flutter_facebook_auth/flutter_facebook_auth.dart';

class FacebookAuthService {
  Future<Map<String, dynamic>?> signIn() async {
    final result = await FacebookAuth.instance.login(
      permissions: ['email', 'public_profile'],
    );

    if (result.status == LoginStatus.success) {
      final token = result.accessToken!;
      return {
        'accessToken': token.tokenString,
        'userId': token.userId,
      };
    }
    return null;  // 取消或失败
  }

  Future<void> signOut() => FacebookAuth.instance.logOut();
}
```

#### Apple 登录（Flutter）

```dart
// lib/services/auth/apple_auth_service.dart
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

class AppleAuthService {
  Future<Map<String, dynamic>?> signIn() async {
    try {
      final credential = await SignInWithApple.getAppleIDCredential(
        scopes: [
          AppleIDAuthorizationScopes.email,
          AppleIDAuthorizationScopes.fullName,
        ],
      );

      return {
        'code': credential.authorizationCode,
        'idToken': credential.identityToken,
        // 注意：name 只在首次授权时有值
        'firstName': credential.givenName,
        'lastName': credential.familyName,
      };
    } on SignInWithAppleAuthorizationException catch (e) {
      if (e.code == AuthorizationErrorCode.canceled) return null;
      rethrow;
    }
  }
}
```

#### 统一登录 Service（调用后端 API）

```dart
// lib/services/auth/oauth_login_service.dart
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class OAuthLoginService {
  final Dio _dio;
  final _storage = const FlutterSecureStorage();

  OAuthLoginService(String baseUrl)
      : _dio = Dio(BaseOptions(baseUrl: baseUrl));

  /// Google 登录完整流程
  Future<LoginResult> loginWithGoogle() async {
    final googleData = await GoogleAuthService().signIn();
    if (googleData == null) throw Exception('Google login cancelled');

    final resp = await _dio.post('/auth/oauth/google', data: googleData);
    return _handleTokenResponse(resp.data);
  }

  /// Facebook 登录完整流程
  Future<LoginResult> loginWithFacebook() async {
    final fbData = await FacebookAuthService().signIn();
    if (fbData == null) throw Exception('Facebook login cancelled');

    final resp = await _dio.post('/auth/oauth/facebook', data: fbData);
    return _handleTokenResponse(resp.data);
  }

  /// Apple 登录完整流程
  Future<LoginResult> loginWithApple() async {
    final appleData = await AppleAuthService().signIn();
    if (appleData == null) throw Exception('Apple login cancelled');

    final resp = await _dio.post('/auth/oauth/apple', data: appleData);
    return _handleTokenResponse(resp.data);
  }

  Future<LoginResult> _handleTokenResponse(Map<String, dynamic> data) async {
    final accessToken = data['tokens']['accessToken'] as String;
    final refreshToken = data['tokens']['refreshToken'] as String;

    // flutter_secure_storage 写入 Keychain（iOS）/ Keystore（Android）
    await _storage.write(key: 'access_token', value: accessToken);
    await _storage.write(key: 'refresh_token', value: refreshToken);

    return LoginResult.fromJson(data);
  }
}
```

#### Flutter 登录页 UI 片段

```dart
// lib/pages/login_page.dart
class LoginPage extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Column(children: [
      // 手机号 OTP 登录（现有）
      PhoneOtpLoginButton(),

      const Divider(),

      // Google 登录
      SocialLoginButton(
        label: 'Continue with Google',
        icon: Assets.icons.google,
        onPressed: () => context.read<AuthCubit>().loginWithGoogle(),
      ),

      // Facebook 登录
      SocialLoginButton(
        label: 'Continue with Facebook',
        icon: Assets.icons.facebook,
        color: const Color(0xFF1877F2),
        onPressed: () => context.read<AuthCubit>().loginWithFacebook(),
      ),

      // Apple 登录（仅 iOS 显示）
      if (Platform.isIOS || Platform.isMacOS)
        SocialLoginButton(
          label: 'Continue with Apple',
          icon: Assets.icons.apple,
          color: Colors.black,
          onPressed: () => context.read<AuthCubit>().loginWithApple(),
        ),
    ]);
  }
}
```

### 7.5 Flutter 平台原生配置

#### Android 配置

```xml
<!-- android/app/src/main/AndroidManifest.xml -->
<!-- Facebook SDK 必须配置 -->
<meta-data
  android:name="com.facebook.sdk.ApplicationId"
  android:value="@string/facebook_app_id" />

<activity
  android:name="com.facebook.FacebookActivity"
  android:configChanges="keyboard|keyboardHidden|screenLayout|screenSize|orientation"
  android:label="@string/app_name" />
```

```xml
<!-- android/app/src/main/res/values/strings.xml -->
<string name="facebook_app_id">你的_FACEBOOK_APP_ID</string>
<string name="fb_login_protocol_scheme">fb你的_FACEBOOK_APP_ID</string>
```

#### iOS 配置

```xml
<!-- ios/Runner/Info.plist -->
<!-- Google Sign-In -->
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <!-- reversed client ID from GoogleService-Info.plist -->
      <string>com.googleusercontent.apps.XXXXX-YYYY</string>
    </array>
  </dict>
</array>

<!-- Facebook -->
<key>FacebookAppID</key>
<string>你的_FACEBOOK_APP_ID</string>
<key>FacebookClientToken</key>
<string>你的_CLIENT_TOKEN</string>
<key>LSApplicationQueriesSchemes</key>
<array>
  <string>fbapi</string>
  <string>fb-messenger-share-api</string>
</array>
```

```xml
<!-- ios/Runner/Runner.entitlements -->
<!-- Apple Sign In 能力 -->
<key>com.apple.developer.applesignin</key>
<array>
  <string>Default</string>
</array>
```

#### 必须放置的配置文件

| 文件                                  | 平台    | 来源                   |
| ------------------------------------- | ------- | ---------------------- |
| `android/app/google-services.json`    | Android | Firebase Console 下载  |
| `ios/Runner/GoogleService-Info.plist` | iOS     | Firebase Console 下载  |
| `ios/Runner/Runner.entitlements`      | iOS     | Apple Developer Portal |

### 7.6 Flutter Web 的特殊处理

Flutter Web 可以复用 Vue 3 的 HTML SDK 方式，或者用 `google_sign_in` / `flutter_facebook_auth` 的 Web 实现（它们都支持 Web 平台）。

```dart
// Flutter Web 与 Mobile 代码完全相同，插件自动适配平台
// google_sign_in Web 版本会在 index.html 注入 Google SDK
// flutter_facebook_auth Web 版本需要在 index.html 手动引入 FB SDK
```

```html
<!-- web/index.html （Flutter Web 专用） -->
<!-- Facebook SDK（flutter_facebook_auth 官方要求） -->
<script>
  window.fbAsyncInit = function () {
    FB.init({
      appId: "YOUR_APP_ID",
      cookie: true,
      xfbml: true,
      version: "v19.0",
    });
  };
</script>
<script async defer src="https://connect.facebook.net/en_US/sdk.js"></script>
```

### 7.7 关键差异总结

| 问题                    | Vue 3 Web                     | Flutter                           |
| ----------------------- | ----------------------------- | --------------------------------- |
| **Apple 登录支持范围**  | 仅 Safari（iOS/macOS）        | iOS + Android + macOS + Web       |
| **Token 安全存储**      | localStorage（可被 XSS 读取） | Keychain/Keystore（系统级加密）✅ |
| **Google 账号选择体验** | 弹窗（GSI UI）                | 系统原生账号选择器 ✅             |
| **离线 token 刷新**     | 需要手写逻辑                  | Dio Interceptor 自动刷新          |
| **需要后端新接口**      | ❌ 不需要                     | ❌ 不需要                         |
| **调试便利性**          | Chrome DevTools               | Flutter DevTools + `flutter run`  |

### 7.8 Flutter 接入工时估算

| 任务                                      | 工时        |
| ----------------------------------------- | ----------- |
| pubspec.yaml + 依赖安装                   | 0.5h        |
| Google Sign-In 接入（含 Firebase 配置）   | 3h          |
| Facebook Login 接入（含原生配置）         | 4h          |
| Apple Sign-In 接入（含 Entitlement 配置） | 3h          |
| 统一 OAuthLoginService + token 存储       | 2h          |
| 登录页 UI（三个按钮 + 平台判断）          | 2h          |
| 联调测试（真机）                          | 4h          |
| **合计**                                  | **~18-20h** |

> 💡 **与 Vue 3 共用的部分**：后端接口、API 路由、数据库、JWT 验证逻辑 —— 全部不变。

---

## 八、环境变量清单

### 新增变量（需添加到 `deploy/.env.dev` 和 `deploy/.env.prod`）

```bash
# -----------------------------------------------
# 第三方登录 OAuth
# -----------------------------------------------

# Google OAuth
# 获取：https://console.cloud.google.com → APIs & Services → Credentials
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxx     # 如用服务端 PKCE 流才需要

# Facebook OAuth
# 获取：https://developers.facebook.com → My Apps → App ID
FACEBOOK_APP_ID=12345678
FACEBOOK_APP_SECRET=abcdef123456     # 用于 Server-Side token 校验（可选）

# Apple Sign In
# 获取：https://developer.apple.com → Certificates → Services → Sign In with Apple
APPLE_CLIENT_ID=com.joyminis.app      # App Bundle ID 或 Service ID
APPLE_TEAM_ID=XXXXXXXXXX
APPLE_KEY_ID=YYYYYYYYYY
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

### Web 端环境变量（`.env`）

```bash
VITE_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
VITE_FACEBOOK_APP_ID=12345678
VITE_APPLE_CLIENT_ID=com.joyminis.app
VITE_APPLE_REDIRECT_URI=https://api.joyminis.com/auth/oauth/apple/callback
```

### Flutter 编译时环境变量（`--dart-define`）

Flutter 不读 `.env` 文件，通过 `--dart-define` 注入编译时常量：

```bash
# 开发构建
flutter run \
  --dart-define=GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com \
  --dart-define=FACEBOOK_APP_ID=12345678 \
  --dart-define=API_BASE_URL=http://localhost:3000

# 生产构建
flutter build apk --release \
  --dart-define=GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com \
  --dart-define=FACEBOOK_APP_ID=12345678 \
  --dart-define=API_BASE_URL=https://api.joyminis.com
```

```dart
// Flutter 代码中读取
const googleClientId = String.fromEnvironment('GOOGLE_CLIENT_ID');
const apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'https://api.joyminis.com',
);
```

> 也可使用 `flutter_dotenv` 包读取 `.env` 文件（运行时加载），但编译时常量更安全。

### 如何申请各平台 Key/Secret（建议保留）

> **结论：需要写，而且要写详细。**  
> 因为 OAuth 最常见卡点不在后端代码，而在控制台配置（回调域名、Bundle ID、包名、SHA、隐私政策 URL）。

#### A) Google OAuth 申请步骤（Web + Android + iOS）

1. 进入 [Google Cloud Console](https://console.cloud.google.com) 新建或选择 Project。
2. 在 `APIs & Services -> OAuth consent screen` 配置应用信息：
   - App name / Support email
   - Scopes（至少 `email`、`profile`）
   - Test users（开发阶段）
3. 在 `Credentials -> Create Credentials -> OAuth client ID` 创建客户端：
   - **Web 端** 选 `Web application`
   - **Android** 选 `Android`（填 packageName + SHA-1）
   - **iOS** 选 `iOS`（填 Bundle ID）
4. Web 端必须填：
   - `Authorized JavaScript origins`: `http://localhost:5173`、`https://admin.joyminis.com`
   - `Authorized redirect URIs`（如果使用 redirect 流）
5. 记录并保存：
   - `GOOGLE_CLIENT_ID`（必填）
   - `GOOGLE_CLIENT_SECRET`（仅部分服务端流程需要）

常见错误：

- `aud mismatch`：前端使用了 A 项目的 clientId，后端配置了 B 项目 clientId。
- `origin_mismatch`：漏配本地端口或生产域名。

#### B) Facebook OAuth 申请步骤

1. 进入 [Meta for Developers](https://developers.facebook.com) -> `My Apps` 创建 App。
2. 添加产品 `Facebook Login`。
3. 在 `Settings -> Basic` 获取：
   - `FACEBOOK_APP_ID`
   - `FACEBOOK_APP_SECRET`
4. 在 `Facebook Login -> Settings` 配置：
   - `Valid OAuth Redirect URIs`
   - `Client OAuth Login = Yes`
   - `Web OAuth Login = Yes`
5. 若有移动端，补充：
   - Android package name + class name + key hashes
   - iOS Bundle ID
6. App 状态：开发阶段可用测试账号；上线要提交审核（若申请扩展权限）。

常见错误：

- `URL blocked`：redirect URI 不在白名单。
- `userId mismatch`：前端传的 `userId` 与 Graph API 返回 `id` 不一致（后端应拒绝）。

#### C) Apple Sign In 申请步骤

1. 进入 [Apple Developer](https://developer.apple.com/account) 并开通付费开发者账号。
2. 在 `Certificates, Identifiers & Profiles` 中：
   - 创建 `Identifier`（App ID 或 Service ID）
   - 开启 `Sign In with Apple`
3. 创建 Sign In with Apple Key：
   - 得到 `APPLE_KEY_ID`
   - 下载 `.p8`（**只提供一次下载**）
4. 在账号页面获取：
   - `APPLE_TEAM_ID`
   - `APPLE_CLIENT_ID`（Service ID 或 Bundle ID）
5. 把 `.p8` 转为环境变量（注意换行转义）：

```bash
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

常见错误：

- `invalid_client`：`APPLE_CLIENT_ID` 配错（Service ID / Bundle ID 混用）。
- `invalid_grant`：`code` 过期或重放。
- 私钥丢失：`.p8` 未妥善保存，需重新生成 key。

#### D) 本项目最低必填变量对照

| 平台     | 后端必填                      | 前端必填                |
| -------- | ----------------------------- | ----------------------- |
| Google   | `GOOGLE_CLIENT_ID`            | `VITE_GOOGLE_CLIENT_ID` |
| Facebook | （MVP 可无）`FACEBOOK_APP_ID` | `VITE_FACEBOOK_APP_ID`  |
| Apple    | `APPLE_CLIENT_ID`             | `VITE_APPLE_CLIENT_ID`  |

> 当前后端实现对 `Google/Apple` 会做受众校验，因此这两个 `CLIENT_ID` 必须与前端同一应用配置。

#### E) 配置完成后的验收顺序

1. 先在前端拿到第三方 token（Google idToken / Facebook accessToken / Apple idToken）。
2. 调后端 `POST /auth/oauth/:provider`。
3. 检查返回是否含 `tokens.accessToken`。
4. 检查数据库：`oauth_accounts` 有新纪录，`user_login_logs` 有 `loginType=3`。
5. 再验证 `GET /auth/profile` 是否可正常访问。

---

## 九、安全清单

### 9.1 Token 验证安全

| 风险                 | 防御措施                                          |
| -------------------- | ------------------------------------------------- |
| 伪造 Google id_token | 验证 `aud`（必须等于 GOOGLE_CLIENT_ID）+ 验证签名 |
| Facebook userId 伪造 | 后端比对 API 返回的 `id` 与请求中的 `userId`      |
| Apple token 过期     | `jwt.verify` 自动检查 `exp`                       |
| 重放攻击             | 三方 token 本身有短 TTL（5分钟），配合限流即可    |
| MITM 中间人          | 全程 HTTPS，token 不进 query string               |

### 9.2 限流配置

```typescript
// 三方登录接口限流（比 OTP 宽松，因为已有三方平台做了防滥用）
@Throttle({ default: { limit: 10, ttl: 60_000 } })  // 1分钟 10次
```

### 9.3 账号安全

```
- 三方登录用户无密码 → 不影响安全（token 就是凭证）
- 已有手机号的用户绑定三方 → 需要先验证手机 OTP（防止越权绑定）
- OauthAccount.bindStatus 软删除 → 解绑后数据保留，可追溯
- providerUserId 不可被用户修改 → 存库后只读
```

### 9.4 隐私合规

```
- Apple 要求：若提供了 Google/FB 登录，必须同时支持 Apple 登录（App Store 政策）
- GDPR：三方授权数据（email/name）的存储需告知用户
- 菲律宾 DPA：个人数据处理需符合《数据隐私法》
```

### 9.5 头像/昵称同步策略（已落地）

```
- 首次 OAuth 登录：可用 provider 返回的 nickname/avatar 初始化本地资料
- 非首次登录：若本地 nickname/avatar 已有值，则不覆盖（尊重用户本地编辑）
- 仅在本地字段为空时，才回填 provider 的 nickname/avatar
- OauthAccount 中 provider 昵称/头像仍可更新，用于审计和后续对账，不直接覆盖 User 展示字段
```

对应后端实现：`apps/api/src/client/auth/auth.service.ts` 中 `loginWithOauth()` 的 pseudo user 分支。

为什么这样做：

1. 用户体验：用户手动改过头像/昵称后，不会被下次第三方登录“冲掉”。
2. 业务一致性：前台展示以本地用户资料为准，第三方资料作为外部身份参考。
3. 可回溯：仍保留 provider 原始信息到 `oauth_accounts`，便于排查绑定问题。

---

## 十、测试策略

### 10.1 单元测试（Vitest / Jest）

```typescript
// auth.service.spec.ts 新增测试用例

describe("loginWithOauth", () => {
  it("Google 新用户 → 创建 User + OauthAccount + 返回 tokens", async () => {
    // mock prisma.$transaction
    // 断言 user.upsert + oauthAccount.upsert 被调用
    // 断言返回 tokens 结构
  });

  it("Google 老用户 → 更新 lastLoginAt + 返回相同 userId", async () => {
    // mock oauthAccount.findUnique 返回已有记录
    // 断言 user 不重新创建
  });

  it("无效 Google token → 抛出 UnauthorizedException", async () => {
    // mock googleProvider.verifyIdToken 抛错
  });

  it("Facebook userId 不匹配 → 抛出 UnauthorizedException", async () => {
    // mock FB API 返回的 id 与传入 userId 不同
  });
});
```

### 10.2 集成测试

```bash
# 本地测试 Google 登录（需要有效的 id_token）
curl -X POST http://localhost:3000/auth/oauth/google \
  -H "Content-Type: application/json" \
  -d '{"idToken": "eyJ..."}'

# 预期响应
{
  "tokens": { "accessToken": "...", "refreshToken": "..." },
  "id": "clxxxx",
  "nickname": "John Doe",
  "provider": "google"
}
```

---

## 十一、实施 Checklist

### Phase A — 后端（约 2-3 天）

- [ ] 安装依赖：`google-auth-library` / `jsonwebtoken` / `jwks-rsa`
- [ ] 新建 `providers/` 目录 + 三个 Provider 类
- [ ] 新增 `OauthLoginDto` (google/facebook/apple)
- [ ] `AuthService` 新增 `loginWithOauth()` 方法
- [ ] `AuthController` 新增三个 oauth 路由
- [ ] `AuthModule` 引入 `HttpModule` + 注册 Providers
- [ ] 更新 `app.module.ts` 的 Joi 校验（加 GOOGLE_CLIENT_ID 等）
- [ ] 添加绑定/解绑接口（`/auth/oauth/bind/:provider`）
- [ ] 单元测试 `loginWithOauth` 的三种情况
- [ ] Swagger 文档验证

### Phase B — Vue 3 前端（约 1-2 天）

- [ ] `index.html` 引入 Google/Facebook/Apple SDK
- [ ] 新建 `useGoogleLogin / useFacebookLogin / useAppleLogin` composables
- [ ] `src/api/index.ts` 新增三个 authApi 方法
- [ ] 登录页新增三方登录按钮 UI
- [ ] Apple 登录仅在 iOS/macOS 设备显示

### Phase C — Flutter 前端（约 3-4 天）

- [ ] 新建 Flutter 项目（或在现有项目中）
- [ ] `pubspec.yaml` 添加：`google_sign_in` / `flutter_facebook_auth` / `sign_in_with_apple` / `flutter_secure_storage` / `dio`
- [ ] 下载并放置 `google-services.json`（Android）和 `GoogleService-Info.plist`（iOS）
- [ ] 配置 `AndroidManifest.xml`（Facebook App ID）
- [ ] 配置 `ios/Runner/Info.plist`（Google reversed client ID + Facebook keys）
- [ ] 配置 `ios/Runner/Runner.entitlements`（Apple Sign In 能力）
- [ ] 实现 `GoogleAuthService` / `FacebookAuthService` / `AppleAuthService`
- [ ] 实现统一 `OAuthLoginService`（调用后端同一套接口）
- [ ] 实现 `flutter_secure_storage` token 存储逻辑
- [ ] 登录页 UI（三方登录按钮 + Platform.isIOS 判断）
- [ ] 真机联调（Google / Facebook / Apple）

### Phase D — 配置与联调（约 0.5 天）

- [ ] 在各平台控制台创建应用，获取凭证
- [ ] 更新 `deploy/.env.dev` 和 `deploy/.env.prod`（后端变量）
- [ ] Web 端：更新对应项目 `.env`
- [ ] Flutter：配置 `--dart-define` 编译参数（或 `flutter_dotenv`）
- [ ] 配置 Google OAuth 授权来源（`localhost:5173` + `joyminis.com`）
- [ ] 配置 Facebook App 有效 OAuth 重定向 URI
- [ ] 联调三个平台登录流程（Web + Flutter 同时验证）

### Phase E — 上线前检查

- [ ] Apple 账号 → App Store 合规（有 Google/FB 必须有 Apple）
- [ ] 隐私政策更新（说明第三方数据使用）
- [ ] 登录日志确认 `loginType=3` 被正确写入
- [ ] 限流配置在压测下不会误拦截正常用户
- [ ] Flutter 真机测试（iOS + Android 各至少一台）

### Phase F — 无短信预算替代方案（OAuth 主登 + Email OTP 兜底）

> 适用场景：当前不接短信网关，先保障可注册/可登录闭环。  
> 策略：优先三方登录（Google/Facebook/Apple），无法使用三方时走邮箱验证码登录。

- [x] 新增邮箱验证码发送接口：`POST /auth/email/send-code`（`apps/api/src/client/auth/auth.controller.ts`）
- [x] 新增邮箱验证码登录接口：`POST /auth/email/login`（`apps/api/src/client/auth/auth.controller.ts`）
- [ ] Redis 验证码与频控：验证码 TTL 5 分钟、同邮箱 60 秒防重发、同 IP 限流
- [ ] （暂缓）登录页入口策略：主按钮放 OAuth，次级入口放 Email Code 登录
- [ ] 邮件模板与文案：明确“验证码仅用于登录，勿泄露”
- [x] 统一审计：Email OTP 登录同样写 `UserLoginLog`（区分 loginMethod）
- [ ] 安全收口：生产环境禁用测试万能码，错误提示避免邮箱枚举

#### Phase F 前端对接文档（客户端前端，仅接口联调，不改登录页 UI）

> 当前范围：仅完成 API 层联调与类型对齐，登录页入口改造暂缓。

**1) 接口清单**

```http
POST /auth/email/send-code
Content-Type: application/json

{
  "email": "demo@example.com"
}
```

```http
POST /auth/email/login
Content-Type: application/json

{
  "email": "demo@example.com",
  "code": "123456"
}
```

**2) 返回约定**

- `send-code`：`{ sent: true, devCode?: string }`
  - `devCode` 仅非生产环境可能返回，用于本地联调。
- `email/login`：与客户端登录响应保持一致，包含 `tokens.accessToken` / `tokens.refreshToken`。

**3) 客户端前端推荐类型定义（API 层）**

```ts
export interface SendEmailCodePayload {
  email: string;
}

export interface SendEmailCodeResponse {
  sent: boolean;
  devCode?: string;
}

export interface EmailCodeLoginPayload {
  email: string;
  code: string;
}

export interface EmailCodeLoginResponse {
  tokens: {
    accessToken: string;
    refreshToken: string;
  };
  id: string;
  nickname: string | null;
  avatar: string | null;
  email: string;
}
```

**4) 客户端前端 API 封装示例（仅接口，不涉及 UI）**

```ts
export const authApi = {
  // ...existing methods...

  sendEmailCode: (data: { email: string }) =>
    http.post<{ sent: boolean; devCode?: string }>(
      "/auth/email/send-code",
      data,
    ),

  loginWithEmailCode: (data: { email: string; code: string }) =>
    http.post<{
      tokens: { accessToken: string; refreshToken: string };
      id: string;
      nickname: string | null;
      avatar: string | null;
      email: string;
    }>("/auth/email/login", data),
};
```

**5) 联调建议顺序（不改页面也可跑通）**

1. 先在本地调用 `sendEmailCode`，确认返回 `sent=true`。
2. 非生产环境直接用 `devCode` 调 `loginWithEmailCode`。
3. 校验响应里 `tokens.accessToken` 是否可用于后续 `GET /auth/profile`。
4. 后端 DB 验证：`user_login_logs` 存在 `loginMethod=email` 记录。

**6) 错误码与前端提示建议**

- 验证码过期：提示“验证码已过期，请重新发送”。
- 验证码错误：提示“验证码错误，请重试”。
- 请求过频：提示“请求过于频繁，请稍后再试”。
- 不回显邮箱是否存在（避免枚举攻击）。

---

## 十二、学习掌握路径（必读文件与 API）

> 目标：用最短路径“完全掌握”本项目第三方登录（不仅会调用，还知道为什么这样设计）。

### 12.1 必读文件清单（按优先级）

| 优先级 | 文件                                                       | 你要看什么                                                               |
| ------ | ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| P0     | `apps/api/src/client/auth/auth.controller.ts`              | OAuth 路由入口、入参、调用链                                             |
| P0     | `apps/api/src/client/auth/auth.service.ts`                 | `loginWithOauth()` 核心业务：登录即注册 / upsert / 发 token / 写登录日志 |
| P0     | `apps/api/src/client/auth/providers/google.provider.ts`    | Google token 校验逻辑（`aud`、`sub`）                                    |
| P0     | `apps/api/src/client/auth/providers/facebook.provider.ts`  | FB token 校验与 `userId` 一致性校验                                      |
| P0     | `apps/api/src/client/auth/providers/apple.provider.ts`     | Apple idToken 解析与过期/受众校验                                        |
| P0     | `apps/api/prisma/schema.prisma`                            | `OauthAccount` / `User` / `UserLoginLog` 约束与关系                      |
| P1     | `apps/api/src/client/auth/dto/oauth-login.dto.ts`          | 三个平台入参差异                                                         |
| P1     | `apps/api/src/client/auth/dto/oauth-login.response.dto.ts` | OAuth 登录统一返回结构                                                   |
| P1     | `apps/api/src/client/auth/auth.module.ts`                  | Provider 依赖注入与 JWT 配置                                             |
| P1     | `client/src/type/types.ts`                                 | 前端 OAuth 请求/响应类型（示例路径）                                     |
| P1     | `client/src/api/index.ts`                                  | 前端如何调用 `/auth/oauth/*`（示例路径）                                 |
| P2     | `apps/api/src/client/auth/auth.service.spec.ts`            | 新用户/老用户/异常路径测试思路                                           |
| P2     | `apps/api/src/client/auth/providers/*.spec.ts`             | Provider 校验边界条件                                                    |

### 12.2 必会 API（最小闭环）

| API                         | 作用              | 关键入参                               |
| --------------------------- | ----------------- | -------------------------------------- |
| `POST /auth/oauth/google`   | Google 三方登录   | `idToken`, `inviteCode?`               |
| `POST /auth/oauth/facebook` | Facebook 三方登录 | `accessToken`, `userId`, `inviteCode?` |
| `POST /auth/oauth/apple`    | Apple 三方登录    | `idToken`, `code?`, `inviteCode?`      |
| `POST /auth/refresh`        | 刷新 token        | `refreshToken`                         |
| `GET /auth/profile`         | 获取当前用户信息  | Bearer Token                           |

### 12.3 建议学习顺序（2-3 小时速通）

1. 先读 `auth.controller.ts`，画出三条 OAuth 路由到 `AuthService` 的调用图。
2. 再读 `auth.service.ts` 的 `loginWithOauth()`，按“老用户复用 / 新用户创建”两条分支理解。
3. 对照 `schema.prisma` 看 `@@unique([provider, providerUserId])` 为什么是核心约束。
4. 精读三个 Provider，理解三平台 token 校验差异。
5. 最后看 `*.spec.ts`，把异常路径（无效 token、ID 不匹配）一次性补齐。

### 12.4 需要真正吃透的 5 个设计点

1. **为什么是客户端令牌流**：更适合 SPA/小程序/Flutter，多端统一接口。
2. **为什么要 upsert OauthAccount**：保证幂等和重复登录稳定。
3. **为什么要“登录即注册”**：降低首登门槛，先拿到会话再引导补全资料。
4. **为什么写 UserLoginLog**：审计、风控、问题追溯都依赖登录日志。
5. **为什么校验 audience / userId**：防止拿别的应用 token 或伪造 ID 越权登录。

### 12.5 自测清单（学完可快速自证）

- 能说清 Google / Facebook / Apple 三个平台入参和验证差异。
- 能解释 `OauthAccount` 唯一索引如何避免重复绑定。
- 能手写出 `loginWithOauth()` 的核心事务步骤（查绑→建/更 user→upsert oauth→写 log→发 token）。
- 能用单测覆盖“成功登录 / token 无效 / 账号复用”三条主路径。

---

## 十三、Lucky Draw 通知方案（拼团成功后）

> 目标：拼团成功并完成开奖后，用户能被及时通知“有抽奖券可用/开奖结果可查”。

### 13.1 当前状态（代码现状）

- 已有拼团状态通知：`GROUP_SUCCESS` / `GROUP_FAILED` / `GROUP_UPDATE`（Socket + FCM）。
- 已有抽奖接口：
  - `GET /lucky-draw/my-tickets`
  - `POST /lucky-draw/tickets/:ticketId/draw`
  - `GET /lucky-draw/my-results`
- 已有团成功后发券逻辑：`GroupProcessor -> LuckyDrawService.issueTicketsForGroup(groupId)`。
- 当前缺口：没有“抽奖券已发放”专用实时事件，前端主要靠用户手动进页面拉接口。

### 13.2 推荐方案（实时 + 兜底）

采用 **Hybrid**：`Socket 精准通知 + API 兜底拉取`。

1. 发券成功后，给用户私有房间推送专用事件（低延迟）。
2. 前端收到事件后立即调用 `my-tickets` 做最终一致性确认。
3. Socket 断线/丢包时，页面进入仍走 API 拉取，保证不会漏券。

### 13.3 事件设计（建议）

建议在共享常量中新增：

- `LUCKY_DRAW_TICKET_ISSUED`
- `LUCKY_DRAW_RESULT_READY`（可选，后续用于“开奖完成”提示）

建议 payload：

```json
{
  "type": "lucky_draw_ticket_issued",
  "data": {
    "groupId": "grp_xxx",
    "ticketId": "tkt_xxx",
    "activityId": "act_xxx",
    "orderId": "ord_xxx",
    "issuedAt": 1760000000000
  }
}
```

### 13.4 触发时机（建议）

- 触发点：`issueTicketsForGroup()` 成功创建 ticket 之后。
- 发送目标：`user_{userId}` 私有房间（不要广播全大厅）。
- 失败策略：推送失败不回滚发券事务，改走日志 + 重试任务。

### 13.5 可靠性与幂等

- 发券幂等：依赖 `uk_ticket_order_activity` 唯一键（同订单同活动只发一张）。
- 通知重试：建议将“通知发送”放入队列任务，支持重试与失败告警。
- 前端幂等：同一 `ticketId` 重复事件只处理一次。

### 13.6 最小实施 Checklist

- [x] 共享常量：在 `packages/shared/src/im/constants.ts` 增加 `LUCKY_DRAW_TICKET_ISSUED`
- [x] 后端推送：在 `LuckyDrawService.issueTicketsForGroup()` 发券成功后 `dispatchToUser`
- [ ] 客户端监听：监听 `dispatch` 中的 `lucky_draw_ticket_issued`
- [ ] API 兜底：事件触发后调用 `GET /lucky-draw/my-tickets?unusedOnly=true`
- [ ] 验收：拼团成功后 3 秒内收到提示，且票列表出现新 ticket

---

## 附录：技术决策记录

### ADR-001: 为什么不用 Passport.js OAuth 策略？

`passport-google-oauth20` / `passport-facebook` 这些策略默认走**服务端重定向**流程，适合传统 Web 应用。而本项目的前端是 Vue 3 SPA + 小程序，客户端已有 Google/FB SDK，直接拿到 `id_token` 后发给后端验证更简洁高效，无需维护 session 或 OAuth state。

**Flutter 同样受益**：Flutter 使用 `google_sign_in` / `flutter_facebook_auth` 等原生插件，直接返回 `id_token`，发给后端接口即可，Passport.js 服务端重定向对 Flutter 完全不适用。

### ADR-002: 为什么用 pseudoPhone 而不让 phone 为 null？

当前 `User.phone` 是 `@unique` 非空字段，用于 OTP 登录的主键查询。为兼容现有 OTP 登录逻辑，三方登录新用户使用 `oauth_{md5(providerUserId)}` 作为占位手机号，后续用户可在设置页补绑真实手机号（走 OTP 验证）。

**Flutter 场景**：Flutter App 用户若先用 Google 登录（无手机号），后续需绑定手机号才能使用提现等功能，前端引导弹窗补绑手机号，体验一致。

**更优方案（二期）**: 将 `phone` 改为可 `null`，增加 `@@index` 避免 null 冲突，同时前端引导三方用户绑定手机号以解锁完整功能（如提现）。

### ADR-003: Apple 私钥存储

Apple `.p8` 私钥不能存明文，应通过环境变量注入（换行用 `\n` 转义）。生产环境优先使用 **密钥管理服务**（AWS Secrets Manager / HashiCorp Vault）而非直接写 `.env.prod`。

### ADR-004: Flutter 为什么不用 Firebase Authentication？

| 方案                       | 优点                                                    | 缺点                                                     | 结论    |
| -------------------------- | ------------------------------------------------------- | -------------------------------------------------------- | ------- |
| **Firebase Auth（托管）**  | 开箱即用，支持 Google/FB/Apple                          | 用户数据在 Firebase，迁移难；多一层依赖；需同步到自己 DB | ❌ 不选 |
| **自建后端验证（本方案）** | 数据完全自控；与现有 JWT 体系统一；无额外 Firebase 费用 | 需要手写 Provider 验证逻辑                               | ✅ 选   |

虽然 Firebase Auth 更快上手，但项目已有完整的 JWT 体系和用户表，引入 Firebase Auth 会造成：

1. 两套用户 ID（Firebase UID vs 自建 `User.id`）
2. 额外的 Firebase 订阅费用（MAU > 5万后收费）
3. 数据出境合规风险（菲律宾 DPA）

因此，继续使用自建后端验证三方 token 是更合适的选择。
