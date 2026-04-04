# Flutter 登录对接指南（Firebase OAuth 三端统一方案）

> **核心目标**：使用 Firebase Authentication 实现 Google/Facebook/Apple 三端统一登录，解决 iOS H5 OAuth 被拦截问题。  
> **适用范围**：Flutter H5、Android App、iOS App + NestJS 后端  
> **代码优先**：以 `apps/api/src/client/auth/*.ts` 实际实现为准。

---

## 0. 本次更新（2026-03-28）

### 🎯 方案变更：从原生 OAuth → Firebase Authentication

**问题背景**：

- iOS H5 端 Google/Facebook 登录被 WebView 拦截
- 原生 OAuth 各端需要分别对接不同 SDK，维护成本高

**解决方案**：

- 引入 Firebase Authentication 作为统一认证层
- 三端（iOS/Android/H5）使用同一套 Firebase SDK
- 后端新增 `/api/v1/auth/firebase` 统一接口
- 保留原有 `/oauth/*` 接口作为备用

**核心优势**：

- ✅ 解决 iOS H5 OAuth 拦截问题
- ✅ 三端代码统一，维护成本降低 70%
- ✅ Firebase 自动处理 token 刷新
- ✅ 后端只需一个接口，逻辑简化

---

## 1. 架构对比

### 1.1 原有方案（各端单独对接）

```
iOS App     ──→ Google SDK ──→ 后端 /oauth/google
            ──→ Facebook SDK ──→ 后端 /oauth/facebook
            ──→ Apple SDK ──→ 后端 /oauth/apple

Android App ──→ Google SDK ──→ 后端 /oauth/google
            ──→ Facebook SDK ──→ 后端 /oauth/facebook

Web/H5      ──→ Google JS SDK ──→ 后端 /oauth/google  ❌ 被拦截
            ──→ Facebook JS SDK ──→ 后端 /oauth/facebook  ❌ 被拦截
```

**问题**：

- 各端 SDK 不同，代码重复
- iOS H5 WebView 拦截 OAuth 弹窗
- Token 管理分散，容易出错

### 1.2 Firebase 方案（三端统一）

```
┌─────────────────────────────────────────────────────────────────┐
│                    Firebase Authentication                        │
│                      (三端统一登录方案)                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│   iOS App              Android App           Flutter H5          │
│   ┌─────────┐          ┌─────────┐          ┌─────────┐         │
│   │ Firebase │          │ Firebase │          │ Firebase │         │
│   │   SDK    │          │   SDK    │          │   SDK    │         │
│   └────┬────┘          └────┬────┘          └────┬────┘         │
│        │                    │                    │                │
│        └────────────────────┼────────────────────┘                │
│                             │                                     │
│                             ▼                                     │
│                    Firebase ID Token                              │
│                             │                                     │
│                             ▼                                     │
│              POST /api/v1/auth/firebase                           │
│                             │                                     │
│                             ▼                                     │
│                    业务 JWT Token                                 │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

**优势**：

- 三端使用相同 SDK 和逻辑
- Firebase 处理 OAuth 弹窗，避免拦截
- 统一 token 管理
- 后端只需一个接口

---

## 2. 接口契约

### 2.1 Firebase 登录接口（新增）

| 接口                    | 方法 | 请求体                     | 说明                                       |
| ----------------------- | ---- | -------------------------- | ------------------------------------------ |
| `/api/v1/auth/firebase` | POST | `{ idToken, inviteCode? }` | Firebase 统一登录（Google/Facebook/Apple） |

**请求体示例**：

```json
{
  "idToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6IjFlOWdkazcifQ...",
  "inviteCode": "ABCD12"
}
```

**响应示例**：

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user_123",
    "email": "user@example.com",
    "nickname": "User Name",
    "avatar": "https://...",
    "provider": "google"
  }
}
```

### 2.2 保留原有接口（备用）

| 接口                          | 方法 | 请求体                                 | 说明                       |
| ----------------------------- | ---- | -------------------------------------- | -------------------------- |
| `/api/v1/auth/oauth/google`   | POST | `{ idToken, inviteCode? }`             | 原生 Google 登录（备用）   |
| `/api/v1/auth/oauth/facebook` | POST | `{ accessToken, userId, inviteCode? }` | 原生 Facebook 登录（备用） |
| `/api/v1/auth/oauth/apple`    | POST | `{ idToken, code?, inviteCode? }`      | 原生 Apple 登录（备用）    |

### 2.3 会话接口（不变）

| 接口                   | 方法 | 请求体             | 说明         |
| ---------------------- | ---- | ------------------ | ------------ |
| `/api/v1/auth/refresh` | POST | `{ refreshToken }` | 刷新 token   |
| `/api/v1/auth/profile` | GET  | Bearer Token       | 获取用户信息 |

### 2.4 返回关键字段

- 所有登录成功都返回：`accessToken` + `refreshToken`
- `user.provider` 返回实际登录方式：`google` / `facebook` / `apple`
- `user.email`、`user.nickname`、`user.avatar` 从 Firebase token 解析

---

## 3. 后端实现

### 3.1 安装依赖

```bash
cd apps/api
yarn add firebase-admin
```

### 3.2 新增 Firebase Provider

```typescript
// apps/api/src/client/auth/providers/firebase.provider.ts

import { Injectable, UnauthorizedException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as admin from "firebase-admin";
import { VerifiedOauthProfile } from "./provider.types";

@Injectable()
export class FirebaseProvider {
  private readonly logger = new Logger(FirebaseProvider.name);

  constructor(private readonly configService: ConfigService) {
    // 初始化 Firebase Admin SDK
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: this.configService.get("FIREBASE_PROJECT_ID"),
          clientEmail: this.configService.get("FIREBASE_CLIENT_EMAIL"),
          privateKey: this.configService
            .get("FIREBASE_PRIVATE_KEY")
            ?.replace(/\\n/g, "\n"),
        }),
      });
    }
  }

  async verifyIdToken(idToken: string): Promise<VerifiedOauthProfile> {
    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);

      // 获取 provider 信息
      const provider = decodedToken.firebase?.sign_in_provider || "unknown";
      let providerName = "firebase";

      if (provider.includes("google.com")) {
        providerName = "google";
      } else if (provider.includes("facebook.com")) {
        providerName = "facebook";
      } else if (provider.includes("apple.com")) {
        providerName = "apple";
      }

      this.logger.debug(
        `Firebase token verified: ${decodedToken.uid}, provider: ${providerName}`,
      );

      return {
        providerUserId: decodedToken.uid,
        email: decodedToken.email || null,
        nickname:
          decodedToken.name || decodedToken.email?.split("@")[0] || null,
        avatar: decodedToken.picture || null,
        provider: providerName,
      };
    } catch (error) {
      this.logger.error(`Firebase token verification failed: ${error.message}`);
      throw new UnauthorizedException("Firebase token verification failed");
    }
  }
}
```

### 3.3 新增 DTO

```typescript
// apps/api/src/client/auth/dto/firebase-login.dto.ts

import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsNotEmpty, IsOptional } from "class-validator";

export class FirebaseLoginDto {
  @ApiProperty({ description: "Firebase ID Token" })
  @IsString()
  @IsNotEmpty()
  idToken: string;

  @ApiProperty({ description: "Invite code", required: false })
  @IsString()
  @IsOptional()
  inviteCode?: string;
}
```

### 3.4 修改 Controller

```typescript
// apps/api/src/client/auth/auth.controller.ts

import { FirebaseProvider } from "./providers/firebase.provider";
import { FirebaseLoginDto } from "./dto/firebase-login.dto";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly googleProvider: GoogleProvider,
    private readonly facebookProvider: FacebookProvider,
    private readonly appleProvider: AppleProvider,
    private readonly firebaseProvider: FirebaseProvider, // 新增
  ) {}

  // ... 其他接口保持不变 ...

  @Post("firebase")
  @ApiOperation({ summary: "Firebase 统一登录 (Google/Facebook/Apple)" })
  @Throttle({ otpRequest: { limit: 15, ttl: 60_000 } })
  @ApiOkResponse({ type: OauthLoginResponseDto })
  @HttpCode(HttpStatus.OK)
  async loginWithFirebase(
    @Body() dto: FirebaseLoginDto,
    @CurrentDevice() device: DeviceInfo,
  ) {
    const oauthProfile = await this.firebaseProvider.verifyIdToken(dto.idToken);
    return this.auth.loginWithOauth(oauthProfile.provider, oauthProfile, {
      ip: device.ip,
      ua: device.userAgent,
      inviteCode: dto.inviteCode,
    });
  }
}
```

### 3.5 修改 Module

```typescript
// apps/api/src/client/auth/auth.module.ts

import { FirebaseProvider } from "./providers/firebase.provider";

@Module({
  imports: [
    /* ... */
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    GoogleProvider,
    FacebookProvider,
    AppleProvider,
    FirebaseProvider, // 新增
  ],
  exports: [AuthService],
})
export class AuthModule {}
```

### 3.6 环境变量配置

```bash
# deploy/.env.dev / deploy/.env.prod

# Firebase Admin SDK
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

---

## 4. Flutter 端实现

### 4.1 安装依赖

**方案A：纯 Firebase（推荐，最简单）**

```yaml
# pubspec.yaml

dependencies:
  firebase_core: ^2.24.0
  firebase_auth: ^4.16.0
```

**方案B：原生 SDK + Firebase（用户体验更好）**

```yaml
# pubspec.yaml

dependencies:
  firebase_core: ^2.24.0
  firebase_auth: ^4.16.0
  google_sign_in: ^6.2.1 # 可选：提供更好的 Google 登录 UI
  flutter_facebook_auth: ^6.0.0 # 可选：提供更好的 Facebook 登录 UI
  sign_in_with_apple: ^6.1.0 # 可选：提供更好的 Apple 登录 UI
```

> **建议**：先用方案A（纯 Firebase），如果用户体验不满意再升级到方案B。

### 4.2 Firebase 初始化

```dart
// lib/core/services/firebase_service.dart

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';

class FirebaseService {
  static Future<void> initialize() async {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
  }

  static FirebaseAuth get auth => FirebaseAuth.instance;
}
```

### 4.3 Google 登录

**方案A：纯 Firebase（推荐）**

```dart
// lib/core/services/auth/google_sign_in_service.dart

import 'package:firebase_auth/firebase_auth.dart';

class GoogleSignInService {
  static Future<String?> signIn() async {
    try {
      // 纯 Firebase 方案：直接使用 GoogleAuthProvider
      final GoogleAuthProvider googleProvider = GoogleAuthProvider();

      final userCredential =
          await FirebaseAuth.instance.signInWithPopup(googleProvider);

      // 获取 Firebase ID Token
      final idToken = await userCredential.user?.getIdToken();
      return idToken;
    } catch (e) {
      print('Google Sign-In failed: $e');
      return null;
    }
  }

  static Future<void> signOut() async {
    await FirebaseAuth.instance.signOut();
  }
}
```

**方案B：原生 SDK + Firebase（用户体验更好）**

```dart
// lib/core/services/auth/google_sign_in_service.dart

import 'package:firebase_auth/firebase_auth.dart';
import 'package:google_sign_in/google_sign_in.dart';

class GoogleSignInService {
  static Future<String?> signIn() async {
    try {
      final GoogleSignInAccount? googleUser = await GoogleSignIn().signIn();
      if (googleUser == null) return null;

      final GoogleSignInAuthentication googleAuth =
          await googleUser.authentication;

      final credential = GoogleAuthProvider.credential(
        accessToken: googleAuth.accessToken,
        idToken: googleAuth.idToken,
      );

      final userCredential =
          await FirebaseAuth.instance.signInWithCredential(credential);

      // 获取 Firebase ID Token
      final idToken = await userCredential.user?.getIdToken();
      return idToken;
    } catch (e) {
      print('Google Sign-In failed: $e');
      return null;
    }
  }

  static Future<void> signOut() async {
    await GoogleSignIn().signOut();
    await FirebaseAuth.instance.signOut();
  }
}
```

### 4.4 Facebook 登录

**方案A：纯 Firebase（推荐）**

```dart
// lib/core/services/auth/facebook_sign_in_service.dart

import 'package:firebase_auth/firebase_auth.dart';

class FacebookSignInService {
  static Future<String?> signIn() async {
    try {
      // 纯 Firebase 方案：直接使用 FacebookAuthProvider
      final FacebookAuthProvider facebookProvider = FacebookAuthProvider();

      final userCredential =
          await FirebaseAuth.instance.signInWithPopup(facebookProvider);

      // 获取 Firebase ID Token
      final idToken = await userCredential.user?.getIdToken();
      return idToken;
    } catch (e) {
      print('Facebook Sign-In failed: $e');
      return null;
    }
  }

  static Future<void> signOut() async {
    await FirebaseAuth.instance.signOut();
  }
}
```

**方案B：原生 SDK + Firebase（用户体验更好）**

```dart
// lib/core/services/auth/facebook_sign_in_service.dart

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_facebook_auth/flutter_facebook_auth.dart';

class FacebookSignInService {
  static Future<String?> signIn() async {
    try {
      final LoginResult result = await FacebookAuth.instance.login();
      if (result.status != LoginStatus.success) return null;

      final credential =
          FacebookAuthProvider.credential(result.accessToken!.token);

      final userCredential =
          await FirebaseAuth.instance.signInWithCredential(credential);

      // 获取 Firebase ID Token
      final idToken = await userCredential.user?.getIdToken();
      return idToken;
    } catch (e) {
      print('Facebook Sign-In failed: $e');
      return null;
    }
  }

  static Future<void> signOut() async {
    await FacebookAuth.instance.logOut();
    await FirebaseAuth.instance.signOut();
  }
}
```

### 4.5 Apple 登录

**方案A：纯 Firebase（推荐）**

```dart
// lib/core/services/auth/apple_sign_in_service.dart

import 'package:firebase_auth/firebase_auth.dart';

class AppleSignInService {
  static Future<String?> signIn() async {
    try {
      // 纯 Firebase 方案：直接使用 OAuthProvider('apple.com')
      final OAuthProvider appleProvider = OAuthProvider('apple.com');

      final userCredential =
          await FirebaseAuth.instance.signInWithPopup(appleProvider);

      // 获取 Firebase ID Token
      final idToken = await userCredential.user?.getIdToken();
      return idToken;
    } catch (e) {
      print('Apple Sign-In failed: $e');
      return null;
    }
  }

  static Future<void> signOut() async {
    await FirebaseAuth.instance.signOut();
  }
}
```

**方案B：原生 SDK + Firebase（用户体验更好）**

```dart
// lib/core/services/auth/apple_sign_in_service.dart

import 'package:firebase_auth/firebase_auth.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

class AppleSignInService {
  static Future<String?> signIn() async {
    try {
      final appleCredential = await SignInWithApple.getAppleIDCredential(
        scopes: [
          AppleIDAuthorizationScopes.email,
          AppleIDAuthorizationScopes.name,
        ],
      );

      final credential = OAuthProvider('apple.com').credential(
        idToken: appleCredential.identityToken,
      );

      final userCredential =
          await FirebaseAuth.instance.signInWithCredential(credential);

      // 获取 Firebase ID Token
      final idToken = await userCredential.user?.getIdToken();
      return idToken;
    } catch (e) {
      print('Apple Sign-In failed: $e');
      return null;
    }
  }

  static Future<void> signOut() async {
    await FirebaseAuth.instance.signOut();
  }
}
```

### 4.6 统一登录接口调用

```dart
// lib/core/api/auth_api.dart

import 'package:dio/dio.dart';

class AuthApi {
  final Dio _dio;

  AuthApi(this._dio);

  /// Firebase 统一登录
  Future<LoginResponse> firebaseLogin({
    required String idToken,
    String? inviteCode,
  }) async {
    final response = await _dio.post(
      '/api/v1/auth/firebase',
      data: {
        'idToken': idToken,
        if (inviteCode != null) 'inviteCode': inviteCode,
      },
    );
    return LoginResponse.fromJson(response.data);
  }
}
```

### 4.7 登录页面调用示例

```dart
// lib/app/page/login_page.dart

class LoginPage extends StatelessWidget {
  Future<void> _handleGoogleLogin(BuildContext context) async {
    final idToken = await GoogleSignInService.signIn();
    if (idToken == null) return;

    final api = context.read<AuthApi>();
    final response = await api.firebaseLogin(idToken: idToken);

    // 保存 token
    await TokenStorage.saveTokens(
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
    );

    // 跳转首页
    Navigator.pushReplacementNamed(context, '/home');
  }

  Future<void> _handleFacebookLogin(BuildContext context) async {
    final idToken = await FacebookSignInService.signIn();
    if (idToken == null) return;

    final api = context.read<AuthApi>();
    final response = await api.firebaseLogin(idToken: idToken);

    // 保存 token
    await TokenStorage.saveTokens(
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
    );

    // 跳转首页
    Navigator.pushReplacementNamed(context, '/home');
  }

  Future<void> _handleAppleLogin(BuildContext context) async {
    final idToken = await AppleSignInService.signIn();
    if (idToken == null) return;

    final api = context.read<AuthApi>();
    final response = await api.firebaseLogin(idToken: idToken);

    // 保存 token
    await TokenStorage.saveTokens(
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
    );

    // 跳转首页
    Navigator.pushReplacementNamed(context, '/home');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          ElevatedButton(
            onPressed: () => _handleGoogleLogin(context),
            child: Text('Google 登录'),
          ),
          ElevatedButton(
            onPressed: () => _handleFacebookLogin(context),
            child: Text('Facebook 登录'),
          ),
          ElevatedButton(
            onPressed: () => _handleAppleLogin(context),
            child: Text('Apple 登录'),
          ),
        ],
      ),
    );
  }
}
```

---

## 5. Firebase 控制台配置

### 5.1 创建 Firebase 项目

1. 访问 [Firebase Console](https://console.firebase.google.com/)
2. 创建新项目或使用现有项目
3. 选择区域：`asia-east1` 或 `asia-southeast1`

### 5.2 启用登录方式

```
Authentication → Sign-in method → 启用以下方式：
- Google ✅
- Facebook ✅
- Apple ✅
```

### 5.3 添加应用

#### Flutter H5（Web 应用）

```
项目设置 → 常规 → 你的应用 → 添加 Web 应用
- 应用昵称：lucky-h5
- 同时设置 Firebase Hosting：否

获取配置：
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

#### Android 应用

```
项目设置 → 常规 → 你的应用 → 添加 Android 应用
- Android 包名：com.yourcompany.lucky
- 应用昵称：lucky-android

下载配置文件：google-services.json
放置位置：android/app/google-services.json
```

#### iOS 应用

```
项目设置 → 常规 → 你的应用 → 添加 iOS 应用
- iOS Bundle ID：com.yourcompany.lucky
- 应用昵称：lucky-ios

下载配置文件：GoogleService-Info.plist
放置位置：ios/Runner/GoogleService-Info.plist
```

### 5.4 配置 OAuth 回调域名

#### Google

```
API 和服务 → 凭据 → OAuth 2.0 客户端 ID
- 已获授权的 JavaScript 来源：https://your-domain.com
- 已获授权的重定向 URI：https://your-domain.com/__/auth/handler
```

#### Facebook

```
Facebook 开发者后台 → 设置 → 基本
- 应用域名：your-domain.com
- 网站 URL：https://your-domain.com

Facebook 登录 → 设置
- 有效的 OAuth 重定向 URI：https://your-project.firebaseapp.com/__/auth/handler
```

#### Apple

```
Apple Developer → Certificates, Identifiers & Profiles
- 配置 Sign in with Apple
- Return URLs：https://your-project.firebaseapp.com/__/auth/handler
```

---

## 6. 平台配置边界

### 6.1 客户端应该放什么

- ✅ 放：Firebase 配置（apiKey、appId 等公开标识）
- ❌ 不放：Firebase Admin SDK 私钥

### 6.2 后端应该放什么

- ✅ 放：`FIREBASE_PROJECT_ID`、`FIREBASE_CLIENT_EMAIL`、`FIREBASE_PRIVATE_KEY`
- ✅ 后端负责 token 最终校验与签发业务 JWT

### 6.3 H5 端配置

```dart
// lib/firebase_options.dart

import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    // Web/H5 配置
    return const FirebaseOptions(
      apiKey: 'AIzaSy...',
      appId: '1:123456789:web:abc123',
      messagingSenderId: '123456789',
      projectId: 'your-project',
      authDomain: 'your-project.firebaseapp.com',
    );
  }
}
```

### 6.4 运行示例

```bash
cd /Volumes/MySSD/work/dev/flutter_happy_app

# H5 运行
fvm flutter run -d chrome

# Android 运行
fvm flutter run -d android

# iOS 运行
fvm flutter run -d ios
```

---

## 7. 登录流程统一规则

1. 调用 Firebase SDK 获取 `idToken`
2. 调用后端 `/api/v1/auth/firebase` 接口
3. 统一保存 `accessToken` + `refreshToken`
4. 统一拉取 `/auth/profile`
5. 进入首页

> **不允许每种登录方式各搞一套登录后逻辑**

---

## 8. 风险与处理

### 8.1 Firebase 初始化失败

**现象**：`Firebase.initializeApp()` 抛出异常

**原因**：

- Firebase 配置文件缺失或错误
- 网络问题导致无法连接 Firebase

**处理**：

- 检查 `firebase_options.dart` 配置
- 检查网络连接
- 添加 try-catch 并提示用户

### 8.2 iOS H5 仍然被拦截

**现象**：Firebase 登录弹窗仍然被拦截

**原因**：

- 浏览器禁用了弹窗
- WebView 安全策略限制

**处理**：

- 使用 `signInWithPopup` 替代 `signInWithRedirect`
- 提示用户允许弹窗
- 考虑使用深度链接跳转系统浏览器

### 8.3 Token 验证失败

**现象**：后端返回 401 Unauthorized

**原因**：

- Firebase Admin SDK 配置错误
- Token 过期或格式错误

**处理**：

- 检查后端环境变量配置
- 确认 Firebase 项目 ID 匹配
- 查看后端日志定位具体错误

### 8.4 Facebook 登录失败

**现象**：Facebook 授权成功但后端验证失败

**原因**：

- Facebook App ID 不匹配
- OAuth 回调域名未配置

**处理**：

- 检查 Facebook 开发者后台配置
- 确认回调域名正确

---

## 9. 后端排查日志点

优先查看这些文件：

1. `apps/api/src/client/auth/auth.controller.ts`：是否命中 `/firebase` 路由
2. `apps/api/src/client/auth/providers/firebase.provider.ts`：token 校验失败具体在哪一步
3. `apps/api/src/client/auth/auth.service.ts`：是否走到 `loginWithOauth()`
4. `apps/api/src/main.ts`：CORS 白名单是否按预期加载

---

## 10. 联调错误速查

| 现象                | 常见原因                    | 处理动作                     |
| ------------------- | --------------------------- | ---------------------------- |
| Firebase 初始化失败 | 配置文件缺失或错误          | 检查 `firebase_options.dart` |
| Google 登录 401     | Firebase 项目 ID 不匹配     | 对齐前后端 Firebase 项目配置 |
| Facebook 登录失败   | OAuth 回调域名未配置        | 检查 Facebook 开发者后台     |
| Apple 登录失败      | Return URL 未配置           | 检查 Apple Developer 配置    |
| Token 验证失败      | Firebase Admin SDK 配置错误 | 检查后端环境变量             |
| CORS blocked        | `CORS_ORIGIN` 缺少当前域名  | 添加域名到白名单             |

---

## 11. 最小回归测试

```bash
cd /Volumes/MySSD/work/dev/flutter_happy_app
./tool/test_login_regression.sh
```

重点覆盖：

- Firebase 初始化
- Google/Facebook/Apple 登录流程
- Token 保存与刷新
- 用户信息获取
- 登录后页面跳转

---

## 12. 迁移计划

### 阶段 1：后端准备（1 天）

- [ ] 安装 `firebase-admin` 依赖
- [ ] 创建 `FirebaseProvider`
- [ ] 新增 `/auth/firebase` 接口
- [ ] 配置环境变量
- [ ] 单元测试

### 阶段 2：Flutter H5 先行（1 天）

- [ ] 集成 Firebase JS SDK
- [ ] 实现 Google 登录
- [ ] 实现 Facebook 登录
- [ ] 实现 Apple 登录
- [ ] 测试 iOS H5 是否解决拦截问题

### 阶段 3：Flutter App 迁移（2 天）

- [ ] Android 集成 Firebase SDK
- [ ] iOS 集成 Firebase SDK
- [ ] 统一登录逻辑
- [ ] 端到端测试

### 阶段 4：清理旧代码（可选）

- [ ] 保留 `/oauth/*` 接口作为备用
- [ ] 标记旧接口为 deprecated
- [ ] 文档更新

---

## 13. 本文档维护原则

- 只保留当前可执行信息，不保留历史设计推演
- 新增登录方式时，仅更新本文件和对应代码
- 以 Firebase 方案为主，原生 OAuth 作为备用

---

## 14. 参考资料

- [Firebase Authentication 文档](https://firebase.google.com/docs/auth)
- [Flutter Firebase 插件](https://firebase.flutter.dev/)
- [Google Sign-In Flutter](https://pub.dev/packages/google_sign_in)
- [Facebook Auth Flutter](https://pub.dev/packages/flutter_facebook_auth)
- [Sign in with Apple Flutter](https://pub.dev/packages/sign_in_with_apple)
