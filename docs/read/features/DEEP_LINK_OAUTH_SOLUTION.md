# Deep Link OAuth 三端统一登录方案

## 方案概述

这是一个基于 **Deep Link + Web OAuth** 的优雅解决方案，让所有OAuth逻辑集中在Web端处理，通过Deep Link将Token传回原生App。

## 架构流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                        第一阶段：App发起请求                      │
├─────────────────────────────────────────────────────────────────┤
│  Flutter App                                                    │
│  ┌──────────────┐    url_launcher     ┌──────────────────┐     │
│  │ 点击Google登录 │ ──────────────────→ │ 系统浏览器打开    │     │
│  └──────────────┘                     │ ?client=app      │     │
│                                       │ &platform=ios    │     │
│                                       └──────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    第二阶段：Web端处理OAuth                       │
├─────────────────────────────────────────────────────────────────┤
│  Next.js (前端)                    NestJS (后端)                 │
│  ┌──────────────┐                 ┌──────────────────┐         │
│  │ Luna登录页面  │ ──点击登录──→   │ 处理OAuth回调     │         │
│  │ client=app   │                 │ 1. 换取用户信息   │         │
│  └──────────────┘                 │ 2. 创建/关联用户  │         │
│                                   │ 3. 生成JWT Token │         │
│                                   └──────────────────┘         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    第三阶段：Deep Link回传                        │
├─────────────────────────────────────────────────────────────────┤
│  NestJS后端                                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 检测到 client=app                                        │  │
│  │ 返回 HTTP 302 重定向：                                    │  │
│  │ Location: luna-app://oauth/callback?token=eyJhbG...     │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    第四阶段：App接收Token                         │
├─────────────────────────────────────────────────────────────────┤
│  Flutter App                                                    │
│  ┌──────────────┐    app_links监听   ┌──────────────────┐     │
│  │ 系统唤醒App   │ ←──────────────── │ 截获Deep Link    │     │
│  └──────────────┘                   │ 解析Token        │     │
│        │                            └──────────────────┘     │
│        ▼                                                      │
│  ┌──────────────┐                                             │
│  │ 存储Token    │                                             │
│  │ 进入首页     │                                             │
│  └──────────────┘                                             │
└─────────────────────────────────────────────────────────────────┘
```

## 详细实现

### 1. Flutter App端实现

#### 1.1 配置Deep Link监听

```yaml
# pubspec.yaml
dependencies:
  app_links: ^3.5.0
  url_launcher: ^6.2.0
  flutter_secure_storage: ^9.0.0
```

```dart
// lib/services/deep_link_service.dart
import 'dart:async';
import 'package:app_links/app_links.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class DeepLinkService {
  static final DeepLinkService _instance = DeepLinkService._internal();
  factory DeepLinkService() => _instance;
  DeepLinkService._internal();

  final _appLinks = AppLinks();
  final _storage = const FlutterSecureStorage();
  StreamSubscription<Uri>? _linkSubscription;

  // 初始化Deep Link监听
  void init() {
    // 监听冷启动时的Deep Link
    _appLinks.getInitialLink().then(_handleLink);

    // 监听App在前台时的Deep Link
    _linkSubscription = _appLinks.uriLinkStream.listen(_handleLink);
  }

  // 处理Deep Link
  void _handleLink(Uri? uri) {
    if (uri == null) return;

    // 检查是否是OAuth回调
    if (uri.scheme == 'luna-app' && uri.host == 'oauth') {
      _handleOAuthCallback(uri);
    }
  }

  // 处理OAuth回调
  Future<void> _handleOAuthCallback(Uri uri) async {
    try {
      // 解析Token
      final token = uri.queryParameters['token'];
      final refreshToken = uri.queryParameters['refreshToken'];

      if (token != null) {
        // 存储Token
        await _storage.write(key: 'auth_token', value: token);
        if (refreshToken != null) {
          await _storage.write(key: 'refresh_token', value: refreshToken);
        }

        // 通知App登录成功
        _onLoginSuccess?.call(token);

        // 关闭浏览器（如果还开着）
        await _closeInAppBrowser();
      }
    } catch (e) {
      print('OAuth callback error: $e');
      _onLoginError?.call(e.toString());
    }
  }

  // 登录成功回调
  Function(String token)? _onLoginSuccess;
  Function(String error)? _onLoginError;

  void setLoginCallback({
    required Function(String token) onSuccess,
    Function(String error)? onError,
  }) {
    _onLoginSuccess = onSuccess;
    _onLoginError = onError;
  }

  // 关闭应用内浏览器
  Future<void> _closeInAppBrowser() async {
    // 这里可以调用 url_launcher 的 close 方法
    // 或者通过Platform Channel通知原生层关闭
  }

  void dispose() {
    _linkSubscription?.cancel();
  }
}
```

#### 1.2 登录页面实现

```dart
// lib/pages/login_page.dart
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/deep_link_service.dart';

class LoginPage extends StatefulWidget {
  @override
  _LoginPageState createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _deepLinkService = DeepLinkService();
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    _initDeepLinkListener();
  }

  void _initDeepLinkListener() {
    _deepLinkService.setLoginCallback(
      onSuccess: (token) {
        setState(() => _isLoading = false);
        // 导航到首页
        Navigator.pushReplacementNamed(context, '/home');
      },
      onError: (error) {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Login failed: $error')),
        );
      },
    );
  }

  // 发起OAuth登录
  Future<void> _loginWithProvider(String provider) async {
    setState(() => _isLoading = true);

    try {
      // 构建OAuth URL
      final platform = Theme.of(context).platform == TargetPlatform.iOS
          ? 'ios'
          : 'android';

      final oauthUrl = Uri.parse(
        'https://auth.luna.com/login'
        '?client=app'
        '&platform=$platform'
        '&provider=$provider'
        '&callback=luna-app://oauth/callback',
      );

      // 使用系统浏览器打开
      if (await canLaunchUrl(oauthUrl)) {
        await launchUrl(
          oauthUrl,
          mode: LaunchMode.inAppBrowserView, // iOS: SFSafariViewController
          // mode: LaunchMode.externalApplication, // 或者完全跳出App
        );
      } else {
        throw 'Could not launch $oauthUrl';
      }
    } catch (e) {
      setState(() => _isLoading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to open login page: $e')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // Luna Logo
            Image.asset('assets/luna_logo.png', width: 120),
            SizedBox(height: 48),

            Text(
              'Welcome to Luna',
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            SizedBox(height: 32),

            // Google登录按钮
            _buildLoginButton(
              icon: Icons.g_mobiledata,
              text: 'Continue with Google',
              onPressed: () => _loginWithProvider('google'),
            ),
            SizedBox(height: 16),

            // Facebook登录按钮
            _buildLoginButton(
              icon: Icons.facebook,
              text: 'Continue with Facebook',
              onPressed: () => _loginWithProvider('facebook'),
            ),
            SizedBox(height: 16),

            // Apple登录按钮（仅iOS显示）
            if (Theme.of(context).platform == TargetPlatform.iOS)
              _buildLoginButton(
                icon: Icons.apple,
                text: 'Continue with Apple',
                onPressed: () => _loginWithProvider('apple'),
              ),

            if (_isLoading) ...[
              SizedBox(height: 24),
              CircularProgressIndicator(),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildLoginButton({
    required IconData icon,
    required String text,
    required VoidCallback onPressed,
  }) {
    return SizedBox(
      width: 280,
      height: 48,
      child: OutlinedButton.icon(
        icon: Icon(icon),
        label: Text(text),
        onPressed: _isLoading ? null : onPressed,
      ),
    );
  }
}
```

#### 1.3 iOS配置

```xml
<!-- ios/Runner/Info.plist -->
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLName</key>
    <string>com.luna.app</string>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>luna-app</string>
    </array>
  </dict>
</array>
```

#### 1.4 Android配置

```xml
<!-- android/app/src/main/AndroidManifest.xml -->
<activity
    android:name=".MainActivity"
    android:launchMode="singleTask">

    <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data
            android:scheme="luna-app"
            android:host="oauth" />
    </intent-filter>
</activity>
```

### 2. Next.js前端实现

#### 2.1 登录页面

```typescript
// app/login/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';

export default function LoginPage() {
  const searchParams = useSearchParams();
  const client = searchParams.get('client'); // 'app' 或 'web'
  const platform = searchParams.get('platform'); // 'ios' 或 'android'
  const callback = searchParams.get('callback'); // Deep Link URL

  const [isLoading, setIsLoading] = useState(false);

  // 处理OAuth登录
  const handleOAuthLogin = async (provider: 'google' | 'facebook' | 'apple') => {
    setIsLoading(true);

    try {
      // 构建回调URL，包含client和callback参数
      const callbackUrl = new URL('/api/auth/callback/' + provider, window.location.origin);
      callbackUrl.searchParams.set('client', client || 'web');
      if (callback) {
        callbackUrl.searchParams.set('callback', callback);
      }

      // 发起OAuth登录
      await signIn(provider, {
        callbackUrl: callbackUrl.toString(),
        redirect: true,
      });
    } catch (error) {
      console.error('Login failed:', error);
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900">
      <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 shadow-2xl">
        {/* Luna Logo */}
        <div className="text-center mb-8">
          <img src="/luna-logo.png" alt="Luna" className="w-24 h-24 mx-auto mb-4" />
          <h1 className="text-3xl font-bold text-white">Welcome to Luna</h1>
          <p className="text-white/60 mt-2">Sign in to continue</p>
        </div>

        {/* 登录按钮 */}
        <div className="space-y-4">
          <button
            onClick={() => handleOAuthLogin('google')}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-100 text-gray-800 font-medium py-3 px-6 rounded-xl transition-all"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              {/* Google Icon */}
            </svg>
            Continue with Google
          </button>

          <button
            onClick={() => handleOAuthLogin('facebook')}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-xl transition-all"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              {/* Facebook Icon */}
            </svg>
            Continue with Facebook
          </button>

          {/* Apple登录仅在iOS显示 */}
          {platform === 'ios' && (
            <button
              onClick={() => handleOAuthLogin('apple')}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-3 bg-black hover:bg-gray-900 text-white font-medium py-3 px-6 rounded-xl transition-all"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                {/* Apple Icon */}
              </svg>
              Continue with Apple
            </button>
          )}
        </div>

        {isLoading && (
          <div className="mt-6 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto"></div>
            <p className="text-white/60 mt-2">Signing in...</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

### 3. NestJS后端实现

#### 3.1 OAuth回调处理

```typescript
// src/client/auth/auth.controller.ts
import { Controller, Get, Query, Res, HttpStatus } from "@nestjs/common";
import { Response } from "express";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // OAuth回调处理
  @Get("callback/:provider")
  async handleOAuthCallback(
    @Query("code") code: string,
    @Query("client") client: string = "web",
    @Query("callback") callback: string,
    @Query("state") state: string,
    @Res() res: Response,
  ) {
    try {
      // 1. 验证并处理OAuth code
      const loginResult = await this.authService.handleOAuthCallback(
        code,
        state, // state中包含provider信息
      );

      // 2. 判断客户端类型
      if (client === "app" && callback) {
        // App端：通过Deep Link回传Token
        const deepLink = new URL(callback);
        deepLink.searchParams.set("token", loginResult.accessToken);
        deepLink.searchParams.set("refreshToken", loginResult.refreshToken);

        // 返回302重定向到Deep Link
        return res.redirect(HttpStatus.FOUND, deepLink.toString());
      } else {
        // Web端：正常设置Cookie并重定向
        res.cookie("auth_token", loginResult.accessToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        });

        return res.redirect(HttpStatus.FOUND, "/dashboard");
      }
    } catch (error) {
      // 错误处理
      const errorUrl =
        client === "app" && callback
          ? `${callback}?error=${encodeURIComponent(error.message)}`
          : `/login?error=${encodeURIComponent(error.message)}`;

      return res.redirect(HttpStatus.FOUND, errorUrl);
    }
  }

  // 获取OAuth授权URL（供App调用）
  @Get("oauth/url")
  async getOAuthUrl(
    @Query("provider") provider: string,
    @Query("client") client: string = "app",
    @Query("platform") platform: string,
    @Query("callback") callback: string,
  ) {
    const state = this.generateState(provider, client, callback);

    const oauthUrls = {
      google: `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams(
        {
          client_id: process.env.GOOGLE_CLIENT_ID,
          redirect_uri: `${process.env.API_URL}/auth/callback/google`,
          response_type: "code",
          scope: "openid email profile",
          state,
        },
      )}`,

      facebook: `https://www.facebook.com/v18.0/dialog/oauth?${new URLSearchParams(
        {
          client_id: process.env.FACEBOOK_APP_ID,
          redirect_uri: `${process.env.API_URL}/auth/callback/facebook`,
          response_type: "code",
          scope: "email public_profile",
          state,
        },
      )}`,

      apple: `https://appleid.apple.com/auth/authorize?${new URLSearchParams({
        client_id: process.env.APPLE_CLIENT_ID,
        redirect_uri: `${process.env.API_URL}/auth/callback/apple`,
        response_type: "code",
        scope: "name email",
        response_mode: "form_post",
        state,
      })}`,
    };

    return { url: oauthUrls[provider] };
  }

  // 生成state参数（包含客户端信息）
  private generateState(
    provider: string,
    client: string,
    callback?: string,
  ): string {
    const stateData = {
      provider,
      client,
      callback,
      nonce: Math.random().toString(36).substring(7),
      timestamp: Date.now(),
    };

    // 加密state（防止篡改）
    return Buffer.from(JSON.stringify(stateData)).toString("base64url");
  }
}
```

#### 3.2 AuthService实现

```typescript
// src/client/auth/auth.service.ts
import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async handleOAuthCallback(code: string, state: string) {
    // 1. 解析state
    const stateData = JSON.parse(
      Buffer.from(state, "base64url").toString("utf-8"),
    );

    const { provider } = stateData;

    // 2. 根据provider换取用户信息
    let oauthProfile;
    switch (provider) {
      case "google":
        oauthProfile = await this.verifyGoogleToken(code);
        break;
      case "facebook":
        oauthProfile = await this.verifyFacebookToken(code);
        break;
      case "apple":
        oauthProfile = await this.verifyAppleToken(code);
        break;
      default:
        throw new Error("Unsupported provider");
    }

    // 3. 查找或创建用户
    let user = await this.prisma.user.findFirst({
      where: {
        oauthAccounts: {
          some: {
            provider,
            providerUserId: oauthProfile.providerUserId,
          },
        },
      },
    });

    if (!user) {
      // 创建新用户
      user = await this.prisma.user.create({
        data: {
          nickname: oauthProfile.nickname,
          avatar: oauthProfile.avatar,
          email: oauthProfile.email,
          oauthAccounts: {
            create: {
              provider,
              providerUserId: oauthProfile.providerUserId,
              email: oauthProfile.email,
            },
          },
        },
      });
    }

    // 4. 生成JWT Token
    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
    });

    const refreshToken = this.jwtService.sign(
      { sub: user.id, type: "refresh" },
      { expiresIn: "30d" },
    );

    // 5. 记录登录日志
    await this.prisma.userLoginLog.create({
      data: {
        userId: user.id,
        loginType: "oauth",
        loginMethod: provider,
        loginStatus: 1,
      },
    });

    return {
      user,
      accessToken,
      refreshToken,
    };
  }

  // 验证Google Token
  private async verifyGoogleToken(code: string) {
    // 用code换取token
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${process.env.API_URL}/auth/callback/google`,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenResponse.json();

    // 获取用户信息
    const userResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      },
    );

    const profile = await userResponse.json();

    return {
      providerUserId: profile.id,
      email: profile.email,
      nickname: profile.name,
      avatar: profile.picture,
    };
  }

  // 验证Facebook Token（类似实现）
  private async verifyFacebookToken(code: string) {
    // 实现类似Google的验证逻辑
  }

  // 验证Apple Token（类似实现）
  private async verifyAppleToken(code: string) {
    // 实现类似Google的验证逻辑
  }
}
```

### 4. 小程序适配方案

```javascript
// 微信小程序登录
// 由于小程序无法直接打开外部浏览器，需要特殊处理

// 方案1：使用web-view组件
// pages/login/login.js
Page({
  data: {
    showWebView: false,
    oauthUrl: "",
  },

  // 点击第三方登录
  async onThirdPartyLogin(e) {
    const provider = e.currentTarget.dataset.provider;

    // 获取OAuth URL
    const res = await wx.request({
      url: "https://api.luna.com/auth/oauth/url",
      data: {
        provider,
        client: "miniprogram",
        platform: "wechat",
      },
    });

    this.setData({
      showWebView: true,
      oauthUrl: res.data.url,
    });
  },

  // 监听web-view消息
  onMessage(e) {
    if (e.detail.data) {
      const { token, refreshToken } = e.detail.data;

      // 存储token
      wx.setStorageSync("auth_token", token);
      wx.setStorageSync("refresh_token", refreshToken);

      // 跳转到首页
      wx.switchTab({ url: "/pages/home/home" });
    }
  },
});
```

```html
<!-- pages/login/login.wxml -->
<view class="login-page">
  <button bindtap="onThirdPartyLogin" data-provider="google">Google登录</button>

  <button bindtap="onThirdPartyLogin" data-provider="facebook">
    Facebook登录
  </button>
</view>

<!-- OAuth WebView -->
<web-view wx:if="{{showWebView}}" src="{{oauthUrl}}" bindmessage="onMessage" />
```

## 配置清单

### 环境变量

```env
# API URL
API_URL=https://api.luna.com

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Facebook OAuth
FACEBOOK_APP_ID=your-facebook-app-id
FACEBOOK_APP_SECRET=your-facebook-app-secret

# Apple OAuth
APPLE_CLIENT_ID=your-apple-client-id
APPLE_TEAM_ID=your-apple-team-id
APPLE_KEY_ID=your-apple-key-id
APPLE_PRIVATE_KEY=your-apple-private-key
```

### OAuth提供商配置

#### Google Cloud Console

```
Authorized redirect URIs:
- https://api.luna.com/auth/callback/google
```

#### Facebook Developer Console

```
Valid OAuth Redirect URIs:
- https://api.luna.com/auth/callback/facebook
```

#### Apple Developer Console

```
Return URLs:
- https://api.luna.com/auth/callback/apple
```

## 优势总结

1. **统一逻辑**：所有OAuth逻辑集中在Web端，维护简单
2. **无需原生SDK**：App不需要集成各平台的原生SDK
3. **用户体验好**：使用系统浏览器，符合Google安全要求
4. **跨平台兼容**：H5、iOS、Android、小程序都可使用
5. **易于扩展**：新增provider只需在Web端添加

## 注意事项

1. **Deep Link安全**：Token通过URL传递，建议使用HTTPS
2. **Token加密**：敏感信息可以加密后再传递
3. **超时处理**：OAuth流程需要设置合理的超时时间
4. **错误处理**：完善的错误提示和降级方案
5. **状态管理**：防止CSRF攻击，使用state参数验证

## 测试要点

1. **各平台Deep Link测试**
   - iOS SFSafariViewController
   - Android Custom Tabs
   - 微信小程序web-view

2. **OAuth流程测试**
   - 正常登录流程
   - 取消登录流程
   - 网络异常处理

3. **Token传递测试**
   - Token完整性
   - Token安全性
   - Token过期处理

4. **边界情况测试**
   - App被杀死后恢复
   - 多次点击登录按钮
   - 网络切换场景
