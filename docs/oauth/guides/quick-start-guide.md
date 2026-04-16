# OAuth Deep Link 快速实施指南

## ✅ 后端已完成

### API端点已创建

```
GET /auth/google/login?callback=luna-app://oauth/callback
GET /auth/google/callback?code=xxx&state=xxx

GET /auth/facebook/login?callback=luna-app://oauth/callback
GET /auth/facebook/callback?code=xxx&state=xxx

GET /auth/apple/login?callback=luna-app://oauth/callback
GET /auth/apple/callback?code=xxx&state=xxx
```

### 工作流程

```
1. App调用: /auth/google/login?callback=luna-app://oauth/callback
2. 后端302重定向到Google授权页
3. 用户授权后Google回调: /auth/google/callback?code=xxx
4. 后端换取用户信息，生成Luna Token
5. 后端302重定向: luna-app://oauth/callback?token=xxx
6. App截获Deep Link，存储Token，登录成功
```

## 📱 Flutter端实现

### 1. 添加依赖

```yaml
# pubspec.yaml
dependencies:
  app_links: ^3.5.0
  url_launcher: ^6.2.0
  flutter_secure_storage: ^9.0.0
```

### 2. 创建登录服务

```dart
// lib/services/oauth_service.dart
import 'dart:async';
import 'package:app_links/app_links.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class OAuthService {
  static final OAuthService _instance = OAuthService._internal();
  factory OAuthService() => _instance;
  OAuthService._internal();

  final _appLinks = AppLinks();
  final _storage = const FlutterSecureStorage();
  StreamSubscription<Uri>? _linkSubscription;

  Completer<String>? _loginCompleter;

  // 初始化Deep Link监听
  void init() {
    _appLinks.getInitialLink().then(_handleLink);
    _linkSubscription = _appLinks.uriLinkStream.listen(_handleLink);
  }

  // 处理Deep Link
  void _handleLink(Uri? uri) {
    if (uri == null) return;

    if (uri.scheme == 'luna-app' && uri.host == 'oauth') {
      final token = uri.queryParameters['token'];
      final refreshToken = uri.queryParameters['refreshToken'];
      final error = uri.queryParameters['error'];

      if (token != null) {
        _storage.write(key: 'auth_token', value: token);
        if (refreshToken != null) {
          _storage.write(key: 'refresh_token', value: refreshToken);
        }
        _loginCompleter?.complete(token);
      } else if (error != null) {
        _loginCompleter?.completeError(error);
      }
    }
  }

  // Google登录
  Future<String> loginWithGoogle() async {
    return _loginWithProvider('google');
  }

  // Facebook登录
  Future<String> loginWithFacebook() async {
    return _loginWithProvider('facebook');
  }

  // Apple登录
  Future<String> loginWithApple() async {
    return _loginWithProvider('apple');
  }

  // 统一登录方法
  Future<String> _loginWithProvider(String provider) async {
    _loginCompleter = Completer<String>();

    final url = Uri.parse(
      'https://api.luna.com/auth/$provider/login'
      '?callback=luna-app://oauth/callback',
    );

    if (await canLaunchUrl(url)) {
      await launchUrl(url, mode: LaunchMode.inAppBrowserView);
    } else {
      throw 'Could not launch $url';
    }

    return _loginCompleter!.future;
  }

  void dispose() {
    _linkSubscription?.cancel();
  }
}
```

### 3. 配置iOS Deep Link

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

### 4. 配置Android Deep Link

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

### 5. 使用示例

```dart
// lib/pages/login_page.dart
import 'package:flutter/material.dart';
import '../services/oauth_service.dart';

class LoginPage extends StatefulWidget {
  @override
  _LoginPageState createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _oauthService = OAuthService();
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    _oauthService.init();
  }

  Future<void> _loginWithGoogle() async {
    setState(() => _isLoading = true);

    try {
      final token = await _oauthService.loginWithGoogle();
      print('Login success: $token');

      // 跳转到首页
      Navigator.pushReplacementNamed(context, '/home');
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Login failed: $e')),
      );
    } finally {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            ElevatedButton(
              onPressed: _isLoading ? null : _loginWithGoogle,
              child: Text('Google登录'),
            ),
            ElevatedButton(
              onPressed: _isLoading ? null : _oauthService.loginWithFacebook,
              child: Text('Facebook登录'),
            ),
            if (Theme.of(context).platform == TargetPlatform.iOS)
              ElevatedButton(
                onPressed: _isLoading ? null : _oauthService.loginWithApple,
                child: Text('Apple登录'),
              ),
            if (_isLoading) CircularProgressIndicator(),
          ],
        ),
      ),
    );
  }
}
```

## 🔧 环境变量配置

### 后端 .env

```env
# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=https://api.luna.com/auth/google/callback

# Facebook OAuth
FACEBOOK_APP_ID=your-facebook-app-id
FACEBOOK_APP_SECRET=your-facebook-app-secret
FACEBOOK_REDIRECT_URI=https://api.luna.com/auth/facebook/callback

# Apple OAuth
APPLE_CLIENT_ID=your-apple-client-id
APPLE_TEAM_ID=your-apple-team-id
APPLE_KEY_ID=your-apple-key-id
APPLE_PRIVATE_KEY=your-apple-private-key
APPLE_REDIRECT_URI=https://api.luna.com/auth/apple/callback
```

## 🎯 测试步骤

1. **启动后端服务**

   ```bash
   cd apps/api
   yarn start:dev
   ```

2. **运行Flutter App**

   ```bash
   cd flutter_app
   flutter run
   ```

3. **测试登录流程**
   - 点击Google登录按钮
   - 系统浏览器打开Google授权页
   - 授权后自动跳转回App
   - 登录成功

## 📊 优势总结

- ✅ **零SDK依赖**：不需要Firebase或各平台原生SDK
- ✅ **统一逻辑**：所有OAuth在后端处理
- ✅ **三端兼容**：H5、iOS、Android都可用
- ✅ **用户体验好**：系统浏览器，无兼容问题
- ✅ **维护简单**：新增provider只需改后端

## 🚀 下一步

1. 配置OAuth提供商的Client ID
2. 在OAuth提供商后台添加回调URL
3. 测试各平台登录流程
4. 添加错误处理和loading状态
