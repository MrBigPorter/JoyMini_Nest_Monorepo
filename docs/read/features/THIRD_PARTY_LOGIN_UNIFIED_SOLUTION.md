# 第三方登录三端统一解决方案

## 问题分析

### 当前问题

1. H5登录卡住或跳转不了
2. APP有时候跳转不了
3. 三端（H5/APP/小程序）登录方式不统一

### 根本原因

- 各端使用不同的SDK和登录流程
- Token格式和验证方式不一致
- 回调处理逻辑分散

## 解决方案：Firebase统一登录

### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                      前端统一层                               │
├─────────────────────────────────────────────────────────────┤
│  H5 (Web)    │   iOS APP   │  Android APP  │  小程序         │
│  Firebase JS │  Firebase   │  Firebase     │  原生SDK        │
│  SDK         │  iOS SDK    │  Android SDK  │  + 云函数       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Firebase Auth  │
                    │  统一认证服务    │
                    └─────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  后端API        │
                    │  /auth/firebase │
                    └─────────────────┘
```

### 优势

1. **统一SDK**：所有平台使用Firebase SDK
2. **统一Token**：所有平台返回相同格式的ID Token
3. **统一接口**：后端只需一个`/auth/firebase`端点
4. **自动降级**：Firebase处理各平台差异

## 实现方案

### 1. H5端实现

```typescript
// lib/firebase-auth.ts
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  FacebookAuthProvider,
  OAuthProvider,
  signInWithCredential,
} from "firebase/auth";

const firebaseConfig = {
  // 你的Firebase配置
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// 统一登录函数
export async function loginWithProvider(
  providerName: "google" | "facebook" | "apple",
) {
  let provider;

  switch (providerName) {
    case "google":
      provider = new GoogleAuthProvider();
      break;
    case "facebook":
      provider = new FacebookAuthProvider();
      break;
    case "apple":
      provider = new OAuthProvider("apple.com");
      break;
  }

  try {
    const result = await signInWithPopup(auth, provider);
    const idToken = await result.user.getIdToken();

    // 调用后端统一接口
    const response = await fetch("/api/v1/auth/firebase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });

    return await response.json();
  } catch (error) {
    console.error("Login failed:", error);
    throw error;
  }
}
```

### 2. iOS APP实现

```swift
// FirebaseAuthManager.swift
import FirebaseAuth
import FirebaseCore
import GoogleSignIn
import FacebookLogin
import AuthenticationServices

class FirebaseAuthManager {

    // 统一登录入口
    func loginWithProvider(_ provider: AuthProvider, from viewController: UIViewController) {
        switch provider {
        case .google:
            loginWithGoogle(from: viewController)
        case .facebook:
            loginWithFacebook(from: viewController)
        case .apple:
            loginWithApple(from: viewController)
        }
    }

    private func loginWithGoogle(from viewController: UIViewController) {
        guard let clientID = FirebaseApp.app()?.options.clientID else { return }

        let config = GIDConfiguration(clientID: clientID)
        GIDSignIn.sharedInstance.configuration = config

        GIDSignIn.sharedInstance.signIn(withPresenting: viewController) { result, error in
            if let error = error {
                self.delegate?.loginDidFail(error: error)
                return
            }

            guard let user = result?.user,
                  let idToken = user.idToken?.tokenString else { return }

            let credential = GoogleAuthProvider.credential(
                withIDToken: idToken,
                accessToken: user.accessToken.tokenString
            )

            self.firebaseSignIn(with: credential)
        }
    }

    private func loginWithFacebook(from viewController: UIViewController) {
        let loginManager = LoginManager()
        loginManager.logIn(permissions: ["public_profile", "email"], from: viewController) { result, error in
            if let error = error {
                self.delegate?.loginDidFail(error: error)
                return
            }

            guard let accessToken = result?.token?.tokenString else { return }

            let credential = FacebookAuthProvider.credential(withAccessToken: accessToken)
            self.firebaseSignIn(with: credential)
        }
    }

    private func loginWithApple(from viewController: UIViewController) {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]

        let authorizationController = ASAuthorizationController(authorizationRequests: [request])
        authorizationController.delegate = self
        authorizationController.presentationContextProvider = viewController as? ASAuthorizationControllerPresentationContextProviding
        authorizationController.performRequests()
    }

    private func firebaseSignIn(with credential: AuthCredential) {
        Auth.auth().signIn(with: credential) { result, error in
            if let error = error {
                self.delegate?.loginDidFail(error: error)
                return
            }

            guard let user = result?.user else { return }

            user.getIDToken { idToken, error in
                if let error = error {
                    self.delegate?.loginDidFail(error: error)
                    return
                }

                guard let idToken = idToken else { return }

                // 调用后端统一接口
                self.callBackendAPI(idToken: idToken)
            }
        }
    }

    private func callBackendAPI(idToken: String) {
        let url = URL(string: "https://your-api.com/v1/auth/firebase")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body = ["idToken": idToken]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: request) { data, response, error in
            // 处理响应
        }.resume()
    }
}
```

### 3. Android APP实现

```kotlin
// FirebaseAuthManager.kt
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.GoogleAuthProvider
import com.google.firebase.auth.FacebookAuthProvider
import com.google.firebase.auth.OAuthProvider
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.facebook.login.LoginManager
import com.facebook.login.LoginResult

class FirebaseAuthManager(private val activity: FragmentActivity) {

    private val auth: FirebaseAuth = FirebaseAuth.getInstance()

    // 统一登录入口
    fun loginWithProvider(provider: AuthProvider) {
        when (provider) {
            AuthProvider.GOOGLE -> loginWithGoogle()
            AuthProvider.FACEBOOK -> loginWithFacebook()
            AuthProvider.APPLE -> loginWithApple()
        }
    }

    private fun loginWithGoogle() {
        val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestIdToken(activity.getString(R.string.default_web_client_id))
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
            val credential = GoogleAuthProvider.getCredential(account?.idToken, null)
            firebaseSignIn(credential)
        } catch (e: ApiException) {
            loginCallback?.onLoginFailed(e)
        }
    }

    private fun loginWithFacebook() {
        LoginManager.getInstance().logInWithReadPermissions(
            activity,
            listOf("public_profile", "email")
        )
    }

    fun handleFacebookLoginResult(loginResult: LoginResult) {
        val credential = FacebookAuthProvider.getCredential(loginResult.accessToken.token)
        firebaseSignIn(credential)
    }

    private fun loginWithApple() {
        val provider = OAuthProvider.newBuilder("apple.com")
            .setScopes(listOf("email", "name"))
            .build()

        auth.startActivityForSignInWithProvider(activity, provider)
            .addOnSuccessListener { result ->
                val idToken = result.credential?.let { credential ->
                    // 获取ID Token
                }
                idToken?.let { callBackendAPI(it) }
            }
            .addOnFailureListener { e ->
                loginCallback?.onLoginFailed(e)
            }
    }

    private fun firebaseSignIn(credential: AuthCredential) {
        auth.signInWithCredential(credential)
            .addOnSuccessListener { result ->
                result.user?.getIdToken(true)?.addOnSuccessListener { tokenResult ->
                    val idToken = tokenResult.token
                    idToken?.let { callBackendAPI(it) }
                }
            }
            .addOnFailureListener { e ->
                loginCallback?.onLoginFailed(e)
            }
    }

    private fun callBackendAPI(idToken: String) {
        // 调用后端 /v1/auth/firebase 接口
        val requestBody = JSONObject().apply {
            put("idToken", idToken)
        }

        // HTTP请求实现
    }
}
```

### 4. 小程序实现（微信小程序）

```javascript
// miniprogram/utils/auth.js
const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

// 小程序登录（需要使用云函数）
async function loginWithProvider(provider) {
  try {
    // 1. 获取微信登录code
    const { code } = await wx.login();

    // 2. 调用云函数处理第三方登录
    const result = await cloud.callFunction({
      name: "oauthLogin",
      data: {
        provider,
        code,
        // 其他参数
      },
    });

    // 3. 云函数内部调用后端API
    return result.result;
  } catch (error) {
    console.error("Login failed:", error);
    throw error;
  }
}

// 云函数 oauthLogin
exports.main = async (event, context) => {
  const { provider, code } = event;

  // 根据provider调用相应的SDK获取token
  // 然后调用后端 /v1/auth/firebase 接口

  const response = await fetch("https://your-api.com/v1/auth/firebase", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });

  return await response.json();
};
```

## 配置要求

### Firebase项目配置

1. 在Firebase Console中启用Google、Facebook、Apple登录
2. 配置各平台的OAuth客户端ID
3. 下载配置文件（google-services.json、GoogleService-Info.plist）

### 后端环境变量

```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-service-account-email
FIREBASE_PRIVATE_KEY=your-private-key
```

## 迁移步骤

### 阶段1：后端准备（已完成）

- ✅ Firebase Provider已实现
- ✅ `/auth/firebase` 端点已就绪

### 阶段2：前端统一

1. **H5端**
   - 安装Firebase JS SDK
   - 替换现有登录逻辑
   - 测试各provider登录

2. **iOS APP**
   - 安装Firebase iOS SDK
   - 配置GoogleService-Info.plist
   - 实现FirebaseAuthManager

3. **Android APP**
   - 安装Firebase Android SDK
   - 配置google-services.json
   - 实现FirebaseAuthManager

4. **小程序**
   - 使用云函数桥接
   - 统一调用后端接口

### 阶段3：测试与优化

1. 各平台功能测试
2. 错误处理优化
3. 用户体验优化

## 优势总结

1. **统一性**：所有平台使用相同的后端接口
2. **可维护性**：登录逻辑集中在Firebase
3. **扩展性**：新增provider只需在Firebase配置
4. **安全性**：Firebase处理token验证
5. **用户体验**：各平台原生登录体验

## 注意事项

1. **网络环境**：确保各平台能访问Firebase服务
2. **降级方案**：保留原有登录方式作为备选
3. **数据迁移**：现有用户数据兼容性
4. **监控告警**：登录失败的监控和告警机制
