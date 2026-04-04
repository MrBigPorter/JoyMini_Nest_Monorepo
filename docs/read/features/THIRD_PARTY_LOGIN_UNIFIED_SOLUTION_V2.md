# 第三方登录三端统一解决方案 V2（不依赖Firebase）

## 问题分析

### 当前问题

1. H5登录卡住或跳转不了
2. APP有时候跳转不了
3. 三端（H5/APP/小程序）登录方式不统一
4. Firebase JS SDK在iOS有兼容性问题

### 根本原因

- 各端使用不同的SDK和登录流程
- Token格式和验证方式不一致
- 回调处理逻辑分散
- 缺乏统一的错误处理机制

## 解决方案：原生SDK + 统一后端接口

### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                      前端各平台原生SDK                        │
├─────────────────────────────────────────────────────────────┤
│  H5 (Web)         │   iOS APP      │  Android APP          │
│  Google Sign-In   │  Google Sign-In│  Google Sign-In       │
│  Facebook SDK     │  Facebook SDK  │  Facebook SDK         │
│  Apple JS SDK     │  Apple Sign In │  Apple Sign In        │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ 统一ID Token格式
                              ▼
                    ┌─────────────────┐
                    │  后端统一接口    │
                    │  /auth/oauth/*  │
                    └─────────────────┘
```

### 核心思路

1. **前端**：各平台使用原生SDK获取ID Token
2. **后端**：统一验证接口，支持多种Token格式
3. **标准化**：定义统一的Token传递规范

## 具体实现

### 1. H5端实现（Google/Facebook/Apple）

```typescript
// lib/oauth-login.ts

// Google登录
export async function loginWithGoogle(): Promise<LoginResult> {
  return new Promise((resolve, reject) => {
    // 加载Google Sign-In SDK
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      // 初始化Google Sign-In
      google.accounts.id.initialize({
        client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
        callback: async (response: any) => {
          try {
            // 调用后端验证
            const result = await fetch("/api/v1/auth/oauth/google", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                idToken: response.credential,
              }),
            });
            const data = await result.json();
            resolve(data);
          } catch (error) {
            reject(error);
          }
        },
      });

      // 触发登录
      google.accounts.id.prompt();
    };
    document.head.appendChild(script);
  });
}

// Facebook登录
export async function loginWithFacebook(): Promise<LoginResult> {
  return new Promise((resolve, reject) => {
    // 加载Facebook SDK
    window.fbAsyncInit = function () {
      FB.init({
        appId: process.env.NEXT_PUBLIC_FACEBOOK_APP_ID,
        cookie: true,
        xfbml: true,
        version: "v18.0",
      });

      FB.login(
        async (response: any) => {
          if (response.authResponse) {
            try {
              const result = await fetch("/api/v1/auth/oauth/facebook", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  accessToken: response.authResponse.accessToken,
                  userID: response.authResponse.userID,
                }),
              });
              const data = await result.json();
              resolve(data);
            } catch (error) {
              reject(error);
            }
          } else {
            reject(new Error("Facebook login cancelled"));
          }
        },
        { scope: "public_profile,email" },
      );
    };

    // 加载SDK
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  });
}

// Apple登录
export async function loginWithApple(): Promise<LoginResult> {
  return new Promise((resolve, reject) => {
    // Apple Sign-In JS SDK
    const AppleID = (window as any).AppleID;

    AppleID.auth.init({
      clientId: process.env.NEXT_PUBLIC_APPLE_CLIENT_ID,
      scope: "name email",
      redirectURI: process.env.NEXT_PUBLIC_APPLE_REDIRECT_URI,
      usePopup: true,
    });

    document.addEventListener("AppleIDSignInOnSuccess", async (event: any) => {
      try {
        const result = await fetch("/api/v1/auth/oauth/apple", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idToken: event.detail.authorization.id_token,
          }),
        });
        const data = await result.json();
        resolve(data);
      } catch (error) {
        reject(error);
      }
    });

    document.addEventListener("AppleIDSignInOnFailure", (event: any) => {
      reject(new Error("Apple login failed"));
    });

    AppleID.auth.signIn();
  });
}
```

### 2. iOS APP实现

```swift
// OAuthLoginManager.swift
import GoogleSignIn
import FacebookLogin
import AuthenticationServices

class OAuthLoginManager: NSObject {

    weak var viewController: UIViewController?
    var loginCompletion: ((Result<LoginResponse, Error>) -> Void)?

    // MARK: - Google登录
    func loginWithGoogle() {
        guard let clientID = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String else {
            return
        }

        let config = GIDConfiguration(clientID: clientID)
        GIDSignIn.sharedInstance.configuration = config

        GIDSignIn.sharedInstance.signIn(withPresenting: viewController!) { [weak self] result, error in
            if let error = error {
                self?.loginCompletion?(.failure(error))
                return
            }

            guard let user = result?.user,
                  let idToken = user.idToken?.tokenString else {
                self?.loginCompletion?(.failure(LoginError.invalidToken))
                return
            }

            // 调用后端
            self?.callBackendAPI(provider: "google", token: idToken)
        }
    }

    // MARK: - Facebook登录
    func loginWithFacebook() {
        let loginManager = LoginManager()
        loginManager.logIn(permissions: ["public_profile", "email"], from: viewController) { [weak self] result, error in
            if let error = error {
                self?.loginCompletion?(.failure(error))
                return
            }

            guard let accessToken = result?.token?.tokenString else {
                self?.loginCompletion?(.failure(LoginError.invalidToken))
                return
            }

            // 调用后端
            self?.callBackendAPI(provider: "facebook", accessToken: accessToken)
        }
    }

    // MARK: - Apple登录
    func loginWithApple() {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]

        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        controller.performRequests()
    }

    // MARK: - 调用后端API
    private func callBackendAPI(provider: String, token: String? = nil, accessToken: String? = nil) {
        var url: URL
        var body: [String: Any]

        switch provider {
        case "google":
            url = URL(string: "\(APIBaseURL)/v1/auth/oauth/google")!
            body = ["idToken": token ?? ""]
        case "facebook":
            url = URL(string: "\(APIBaseURL)/v1/auth/oauth/facebook")!
            body = ["accessToken": accessToken ?? "", "userID": ""]
        case "apple":
            url = URL(string: "\(APIBaseURL)/v1/auth/oauth/apple")!
            body = ["idToken": token ?? ""]
        default:
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            if let error = error {
                DispatchQueue.main.async {
                    self?.loginCompletion?(.failure(error))
                }
                return
            }

            guard let data = data,
                  let response = try? JSONDecoder().decode(LoginResponse.self, from: data) else {
                DispatchQueue.main.async {
                    self?.loginCompletion?(.failure(LoginError.invalidResponse))
                }
                return
            }

            DispatchQueue.main.async {
                self?.loginCompletion?(.success(response))
            }
        }.resume()
    }
}

// MARK: - ASAuthorizationControllerDelegate
extension OAuthLoginManager: ASAuthorizationControllerDelegate {
    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        if let appleIDCredential = authorization.credential as? ASAuthorizationAppleIDCredential {
            guard let identityToken = appleIDCredential.identityToken,
                  let idTokenString = String(data: identityToken, encoding: .utf8) else {
                loginCompletion?(.failure(LoginError.invalidToken))
                return
            }

            callBackendAPI(provider: "apple", token: idTokenString)
        }
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        loginCompletion?(.failure(error))
    }
}
```

### 3. Android APP实现

```kotlin
// OAuthLoginManager.kt
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException
import com.facebook.login.LoginManager
import com.facebook.login.LoginResult
import com.google.firebase.auth.FirebaseAuth

class OAuthLoginManager(private val activity: FragmentActivity) {

    private val auth: FirebaseAuth = FirebaseAuth.getInstance()
    var loginCallback: LoginCallback? = null

    companion object {
        private const val RC_GOOGLE_SIGN_IN = 9001
    }

    // MARK: - Google登录
    fun loginWithGoogle() {
        val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestIdToken(activity.getString(R.string.google_client_id))
            .requestEmail()
            .build()

        val googleSignInClient = GoogleSignIn.getClient(activity, gso)
        val signInIntent = googleSignInClient.signInIntent
        activity.startActivityForResult(signInIntent, RC_GOOGLE_SIGN_IN)
    }

    fun handleGoogleSignInResult(data: Intent?) {
        val task = GoogleSignIn.getSignedInAccountFromIntent(data)
        try {
            val account = task.getResult(ApiException::class.java)
            val idToken = account?.idToken

            if (idToken != null) {
                callBackendAPI("google", idToken)
            } else {
                loginCallback?.onLoginFailed(Exception("Failed to get ID token"))
            }
        } catch (e: ApiException) {
            loginCallback?.onLoginFailed(e)
        }
    }

    // MARK: - Facebook登录
    fun loginWithFacebook() {
        LoginManager.getInstance().logInWithReadPermissions(
            activity,
            listOf("public_profile", "email")
        )
    }

    fun handleFacebookLoginResult(loginResult: LoginResult) {
        val accessToken = loginResult.accessToken.token
        callBackendAPI("facebook", accessToken = accessToken)
    }

    // MARK: - Apple登录
    fun loginWithApple() {
        val provider = com.google.firebase.auth.OAuthProvider.newBuilder("apple.com")
            .setScopes(listOf("email", "name"))
            .build()

        auth.startActivityForSignInWithProvider(activity, provider)
            .addOnSuccessListener { result ->
                result.user?.getIdToken(true)?.addOnSuccessListener { tokenResult ->
                    val idToken = tokenResult.token
                    if (idToken != null) {
                        callBackendAPI("apple", idToken)
                    }
                }
            }
            .addOnFailureListener { e ->
                loginCallback?.onLoginFailed(e)
            }
    }

    // MARK: - 调用后端API
    private fun callBackendAPI(provider: String, idToken: String? = null, accessToken: String? = null) {
        val url = when (provider) {
            "google" -> "${API_BASE_URL}/v1/auth/oauth/google"
            "facebook" -> "${API_BASE_URL}/v1/auth/oauth/facebook"
            "apple" -> "${API_BASE_URL}/v1/auth/oauth/apple"
            else -> return
        }

        val body = when (provider) {
            "google", "apple" -> JSONObject().apply {
                put("idToken", idToken)
            }
            "facebook" -> JSONObject().apply {
                put("accessToken", accessToken)
                put("userID", "") // 需要从Facebook获取
            }
            else -> return
        }

        val request = JsonObjectRequest(
            Request.Method.POST,
            url,
            body,
            { response ->
                val loginResponse = parseLoginResponse(response)
                loginCallback?.onLoginSuccess(loginResponse)
            },
            { error ->
                loginCallback?.onLoginFailed(error)
            }
        )

        Volley.newRequestQueue(activity).add(request)
    }
}
```

### 4. 小程序实现（微信小程序）

```javascript
// oauth-login.js

// 小程序不支持直接的第三方登录，需要通过后端代理
// 方案1：使用后端生成的登录链接
// 方案2：使用WebView嵌入H5登录页

// 方案1：后端代理登录
async function loginWithProvider(provider) {
  try {
    // 1. 获取微信code
    const { code } = await wx.login();

    // 2. 调用后端获取OAuth登录URL
    const urlResponse = await wx.request({
      url: "https://your-api.com/v1/auth/oauth/url",
      method: "POST",
      data: {
        provider: provider,
        wxCode: code,
        redirectUrl: "your-scheme://oauth-callback",
      },
    });

    // 3. 打开OAuth登录页面
    const oauthUrl = urlResponse.data.url;

    // 使用小程序的web-view组件打开登录页
    wx.navigateTo({
      url: `/pages/webview/webview?url=${encodeURIComponent(oauthUrl)}`,
    });

    // 4. 监听OAuth回调
    // 在app.js中处理scheme回调
  } catch (error) {
    console.error("Login failed:", error);
    throw error;
  }
}

// 方案2：直接调用后端（如果能获取到token）
async function loginWithProviderDirect(provider, token) {
  const url = `https://your-api.com/v1/auth/oauth/${provider}`;

  const response = await wx.request({
    url: url,
    method: "POST",
    data: {
      idToken: token,
    },
  });

  return response.data;
}
```

## 后端接口统一

### 现有接口（已实现）

```
POST /auth/oauth/google     - Google OAuth登录
POST /auth/oauth/facebook   - Facebook OAuth登录
POST /auth/oauth/apple      - Apple OAuth登录
```

### 接口规范

```typescript
// 请求格式
interface OAuthLoginRequest {
  idToken?: string; // Google/Apple使用
  accessToken?: string; // Facebook使用
  userID?: string; // Facebook使用
  inviteCode?: string; // 可选，邀请码
}

// 响应格式
interface LoginResponse {
  user: {
    id: string;
    nickname: string;
    avatar: string;
    phone?: string;
  };
  tokens: {
    accessToken: string;
    refreshToken: string;
  };
  isNewUser: boolean;
}
```

## 配置要求

### H5端配置

```env
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-google-client-id
NEXT_PUBLIC_FACEBOOK_APP_ID=your-facebook-app-id
NEXT_PUBLIC_APPLE_CLIENT_ID=your-apple-client-id
NEXT_PUBLIC_APPLE_REDIRECT_URI=your-redirect-uri
```

### iOS配置

```xml
<!-- Info.plist -->
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>your-app-scheme</string>
    </array>
  </dict>
</array>

<key>GIDClientID</key>
<string>your-google-client-id</string>

<key>FacebookAppID</key>
<string>your-facebook-app-id</string>
```

### Android配置

```xml
<!-- AndroidManifest.xml -->
<activity
    android:name="com.google.android.gms.auth.api.signin.internal.SignInHubActivity"
    android:exported="false" />

<meta-data
    android:name="com.google.android.gms.version"
    android:value="@integer/google_play_services_version" />

<meta-data
    android:name="com.facebook.sdk.ApplicationId"
    android:value="@string/facebook_app_id"/>
```

## 迁移步骤

### 阶段1：H5端改造（1-2天）

1. 集成Google Sign-In JS SDK
2. 集成Facebook JS SDK
3. 集成Apple Sign-In JS SDK
4. 统一调用后端接口
5. 测试各provider登录

### 阶段2：iOS APP改造（2-3天）

1. 集成Google Sign-In iOS SDK
2. 集成Facebook iOS SDK
3. 实现Apple Sign In
4. 统一调用后端接口
5. 测试各provider登录

### 阶段3：Android APP改造（2-3天）

1. 集成Google Sign-In Android SDK
2. 集成Facebook Android SDK
3. 实现Apple Sign In
4. 统一调用后端接口
5. 测试各provider登录

### 阶段4：小程序适配（1-2天）

1. 实现后端代理登录
2. 集成web-view登录页
3. 处理OAuth回调
4. 测试登录流程

## 常见问题解决

### H5登录卡住问题

1. **检查SDK加载**：确保SDK脚本正确加载
2. **检查回调处理**：确保回调函数正确绑定
3. **检查网络请求**：确保后端接口可访问
4. **检查CORS配置**：确保跨域请求正确配置

### APP跳转失败问题

1. **检查URL Scheme**：确保app scheme配置正确
2. **检查SDK初始化**：确保SDK在app启动时初始化
3. **检查权限配置**：确保必要的权限已添加
4. **检查回调处理**：确保AppDelegate/Activity正确处理回调

### Token验证失败问题

1. **检查Token格式**：确保传递正确的token类型
2. **检查Client ID**：确保各平台使用正确的client ID
3. **检查时钟同步**：确保服务器时间正确
4. **检查网络环境**：确保能访问Google/Facebook/Apple服务

## 优势总结

1. **不依赖Firebase**：避免Firebase在iOS的兼容性问题
2. **原生体验**：各平台使用原生SDK，体验最佳
3. **统一后端**：后端接口统一，维护简单
4. **灵活扩展**：新增provider只需添加对应的SDK
5. **错误处理**：统一的错误处理机制

## 注意事项

1. **网络环境**：确保各平台能访问Google/Facebook/Apple服务
2. **降级方案**：保留原有登录方式作为备选
3. **数据迁移**：现有用户数据兼容性
4. **监控告警**：登录失败的监控和告警机制
5. **安全考虑**：Token传输和存储的安全性
