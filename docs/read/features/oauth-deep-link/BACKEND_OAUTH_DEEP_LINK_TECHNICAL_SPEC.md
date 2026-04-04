# 后端OAuth Deep Link技术规范（企业级标准）

> **版本**: 2.0  
> **最后更新**: 2026-03-30  
> **状态**: ✅ 已实施  
> **平台**: iOS, Android, Web/H5  
> **核心特性**: 平台感知架构 + 当前窗口跳转 + State防CSRF

---

## 目录

1. [概述](#概述)
2. [架构设计](#架构设计)
3. [API端点定义](#api端点定义)
4. [State参数设计](#state参数设计)
5. [Apple OAuth特殊处理](#apple-oauth特殊处理)
6. [邀请码支持](#邀请码支持)
7. [Web端优化](#web端优化)
8. [错误处理](#错误处理)
9. [环境变量配置](#环境变量配置)
10. [测试指南](#测试指南)
11. [Flutter对接指南](#flutter对接指南)
12. [常见问题](#常见问题)

---

## 概述

### 为什么选择OAuth Deep Link方案？

我们采用 **OAuth Deep Link** 方案作为统一的三端登录解决方案。这个方案解决了传统OAuth的多个痛点：

1. **零SDK依赖**：移除Firebase、Facebook、Apple原生SDK，减少包大小和复杂度
2. **三端真正统一**：一套代码支持iOS、Android、Web全平台
3. **无视拦截**：服务端302重定向，ITP/Safari无法拦截
4. **零UI负担**：系统浏览器一闪而过，自动唤醒App
5. **维护简单**：所有OAuth逻辑在后端，新增Provider只需改后端

### 核心优势

| 优势             | 描述                            |
| ---------------- | ------------------------------- |
| **零SDK依赖**    | 不需要Firebase或任何原生SDK     |
| **三端真正统一** | 所有OAuth逻辑在后端，三端共用   |
| **无视拦截**     | 服务端302重定向，ITP拦截不到    |
| **零UI负担**     | 系统浏览器一闪而过，自动唤醒App |
| **维护简单**     | 新增provider只需改后端          |
| **成本降低**     | 移除Firebase依赖，减少云成本    |

### 支持的Provider

- ✅ Google Sign-In
- ✅ Facebook Login
- ✅ Apple Sign-In
- ✅ 可扩展其他Provider

---

## 架构设计

### 数据流

```
┌─────────────────────────────────────────────────────────────┐
│                    登录数据流                                   │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  1. Flutter调用后端OAuth入口                                  │
│     launchUrl('https://dev-api.joyminis.com/auth/google/login?callback=joymini://oauth/callback&inviteCode=ABC123')
│           │                                                    │
│           ▼                                                    │
│  2. 后端302重定向到Google授权页                               │
│     https://accounts.google.com/o/oauth2/v2/auth?client_id=...&redirect_uri=...&state=...
│           │                                                    │
│           ▼                                                    │
│  3. 用户在Google页面授权                                      │
│           │                                                    │
│           ▼                                                    │
│  4. Google回调到后端                                          │
│     https://dev-api.joyminis.com/auth/google/callback?code=xxx&state=...
│           │                                                    │
│           ▼                                                    │
│  5. 后端交换Token，获取用户信息                               │
│           │                                                    │
│           ▼                                                    │
│  6. 后端创建/更新用户，生成Luna Token                         │
│           │                                                    │
│           ▼                                                    │
│  7. 后端302重定向到Deep Link                                  │
│     joymini://oauth/callback?token=xxx&refreshToken=xxx       │
│           │                                                    │
│           ▼                                                    │
│  8. Flutter接收Deep Link，完成登录                            │
│           │                                                    │
│           ▼                                                    │
│  9. Flutter存储Token，跳转到主页                              │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 平台感知架构

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   前端应用      │     │   OAuth后端     │     │  OAuth提供商    │
│   (Web/iOS/Android) │────▶│   (统一入口)   │────▶│ (Google/FB/Apple) │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                       │                       │
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
   平台特定回调          统一token交换          用户授权
```

---

## API端点定义

### 1. 发起授权（GET）

#### 通用参数

- `callback` (必填): Deep Link回调URL，格式：`joymini://oauth/callback`
- `inviteCode` (可选): 邀请码，转发到OAuth流程
- `redirect_uri` (可选，Web端): Web端重定向URI

#### 各Provider端点

##### Google OAuth

```
GET /auth/google/login
```

##### Facebook OAuth

```
GET /auth/facebook/login
```

##### Apple OAuth

```
GET /auth/apple/login
```

### 2. 接收回调（GET/POST）

#### Google回调

```
GET /auth/google/callback?code={code}&state={state}
```

#### Facebook回调

```
GET /auth/facebook/callback?code={code}&state={state}
```

#### Apple回调

```
POST /auth/apple/callback
Content-Type: application/x-www-form-urlencoded

code={code}&state={state}&user={user_json}
```

### 3. 响应处理

#### 成功响应

- **移动端**: 302重定向到Deep Link：`joymini://oauth/callback?token={accessToken}&refreshToken={refreshToken}`
- **Web端**:
  - 如果提供了有效的`redirect_uri`，重定向到该URI并携带token参数
  - 否则设置cookie并重定向到`/dashboard`

#### 错误响应

```json
{
  "success": false,
  "message": "错误描述"
}
```

---

## State参数设计

### State数据结构

```typescript
interface OAuthStateData {
  // 必需字段
  provider: string; // 'google' | 'facebook' | 'apple'
  timestamp: number; // 创建时间戳（毫秒）
  nonce: string; // 随机数，防止重放攻击

  // 可选字段
  callback?: string; // Deep Link回调URL
  inviteCode?: string; // 邀请码
  redirectUri?: string; // Web端重定向URI
  webState?: string; // Web端生成的state（防CSRF）
}
```

### State编码/解码

- **编码**: `base64url(JSON.stringify(stateData))`
- **解码**: `JSON.parse(base64url.decode(state))`

### State验证规则

1. **时间有效性**: 创建时间不超过10分钟
2. **Nonce唯一性**: 防止重放攻击（建议使用Redis存储验证）
3. **参数完整性**: 必需字段必须存在

---

## Apple OAuth特殊处理

### Apple OAuth特点

1. **必须使用POST回调**: Apple要求`response_mode=form_post`
2. **需要动态Client Secret**: 不能使用静态字符串，必须使用JWT
3. **首次登录提供用户信息**: 只在第一次授权时提供用户名

### Apple Client Secret生成

需要使用ES256算法生成JWT，包含以下声明：

```javascript
{
  "iss": "APPLE_TEAM_ID",      // Apple Team ID
  "iat": currentTimestamp,     // 签发时间
  "exp": currentTimestamp + 15777000, // 6个月有效期
  "aud": "https://appleid.apple.com",
  "sub": "APPLE_CLIENT_ID"     // Apple Client ID
}
```

签名使用Apple提供的`.p8`私钥。

### 环境变量要求

```env
APPLE_CLIENT_ID=com.your.bundle.id
APPLE_TEAM_ID=your-team-id
APPLE_KEY_ID=your-key-id
APPLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
APPLE_REDIRECT_URI=https://api.yourdomain.com/auth/apple/callback
```

---

## 邀请码支持

### 邀请码传递流程

1. **Flutter端**: 在调用登录端点时传递`inviteCode`参数
2. **后端**: 将`inviteCode`编码到state中
3. **回调处理**: 从state中解码`inviteCode`并传递给`authService.loginWithOauth()`

### 示例请求

```
GET /auth/google/login?callback=joymini://oauth/callback&inviteCode=INVITE123
```

### 后端处理

```typescript
// 在state中编码邀请码
const stateData = {
  provider: "google",
  callback: callbackUrl,
  inviteCode: inviteCode,
  timestamp: Date.now(),
  nonce: generateNonce(),
};

// 在回调时解码并使用
const loginResult = await authService.loginWithOauth(provider, profile, {
  inviteCode: stateData.inviteCode,
});
```

---

## Web端优化

### Web端特定需求

1. **当前窗口跳转**: 使用`window.location.href`而非新标签页
2. **State防CSRF**: Web端生成state并存储到sessionStorage
3. **Token返回方式**: 支持URL参数、cookie或JSON响应

### Web端回调流程

```
1. Web应用 → 后端OAuth入口 (携带redirect_uri)
2. 后端 → OAuth提供商
3. OAuth提供商 → 后端回调
4. 后端验证state，生成token
5. 后端 → 重定向到redirect_uri?token=xxx&refreshToken=xxx
6. Web应用从URL获取token，清理URL
```

### Web端State管理

```javascript
// 生成并存储state
const state = generateRandomString(32);
sessionStorage.setItem(`oauth_state_${provider}`, state);

// 验证state
const storedState = sessionStorage.getItem(`oauth_state_${provider}`);
if (storedState !== receivedState) {
  throw new Error("Invalid state parameter");
}
sessionStorage.removeItem(`oauth_state_${provider}`);
```

---

## 错误处理

### 常见错误类型

| 错误类型            | HTTP状态码 | 描述                | 解决方案                   |
| ------------------- | ---------- | ------------------- | -------------------------- |
| **无效State**       | 400        | State参数无效或过期 | 重新发起OAuth请求          |
| **OAuth提供商错误** | 400        | OAuth提供商返回错误 | 检查提供商配置             |
| **用户取消授权**    | 200        | 用户在OAuth页面取消 | 静默处理，不显示错误       |
| **网络超时**        | 408        | OAuth流程超时       | 提示用户重试               |
| **内部错误**        | 500        | 后端处理错误        | 记录日志，提示用户联系支持 |

### 错误响应格式

```json
{
  "success": false,
  "message": "错误描述",
  "code": "ERROR_CODE",
  "provider": "google" // 可选，指明哪个Provider出错
}
```

### 用户友好错误提示

- **用户取消**: 不显示错误，静默返回
- **网络问题**: "网络连接失败，请检查网络后重试"
- **配置错误**: "系统配置错误，请联系客服"
- **Token无效**: "登录凭证无效，请重新登录"

---

## 环境变量配置

### 开发环境 (deploy/.env.dev)

```env
# Google OAuth
GOOGLE_CLIENT_ID=XXX
GOOGLE_CLIENT_SECRET=XXX
GOOGLE_REDIRECT_URI=https://dev-api.joyminis.com/auth/google/callback

# Facebook OAuth
FACEBOOK_APP_ID=1659905501858558
FACEBOOK_APP_SECRET=7b5a730eaa1e205de2a5af90dae775aa
FACEBOOK_REDIRECT_URI=https://dev-api.joyminis.com/auth/facebook/callback

# Apple OAuth (需要真实配置)
APPLE_CLIENT_ID=your-apple-client-id
APPLE_TEAM_ID=your-apple-team-id
APPLE_KEY_ID=your-apple-key-id
APPLE_PRIVATE_KEY=your-apple-private-key
APPLE_REDIRECT_URI=https://dev-api.joyminis.com/auth/apple/callback
```

### 生产环境 (deploy/.env.prod)

```env
# Google OAuth
GOOGLE_CLIENT_ID=XXX
GOOGLE_REDIRECT_URI=https://api.joyminis.com/auth/google/callback

# Facebook OAuth
FACEBOOK_APP_ID=1659905501858558
FACEBOOK_APP_SECRET=7b5a730eaa1e205de2a5af90dae775aa
FACEBOOK_REDIRECT_URI=https://api.joyminis.com/auth/facebook/callback

# Apple OAuth (需要真实配置)
APPLE_CLIENT_ID=com.joyminis.app
APPLE_TEAM_ID=your-team-id
APPLE_KEY_ID=your-key-id
APPLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
APPLE_REDIRECT_URI=https://api.joyminis.com/auth/apple/callback
```

### OAuth提供商后台配置

#### Google Cloud Console

```
Authorized redirect URIs:
- https://dev-api.joyminis.com/auth/google/callback
- https://api.joyminis.com/auth/google/callback (生产环境)
```

#### Facebook Developer Console

```
Valid OAuth Redirect URIs:
- https://dev-api.joyminis.com/auth/facebook/callback
- https://api.joyminis.com/auth/facebook/callback (生产环境)
```

#### Apple Developer Console

```
Return URLs:
- https://dev-api.joyminis.com/auth/apple/callback
- https://api.joyminis.com/auth/apple/callback (生产环境)
```

---

## 测试指南

### 单元测试要点

1. **State编码/解码**: 验证state数据的完整往返
2. **Apple Client Secret**: 验证JWT生成和签名
3. **错误处理**: 测试各种错误场景
4. **邀请码传递**: 验证邀请码在流程中的传递

### 集成测试流程

1. **模拟OAuth流程**: 使用测试Client ID/Secret
2. **Deep Link验证**: 验证生成的Deep Link格式
3. **Web端测试**: 测试Web重定向和cookie设置
4. **错误场景**: 测试无效state、取消授权等

### 手动测试清单

- [ ] Google登录 - 移动端 (Deep Link回调)
- [ ] Google登录 - Web端 (当前窗口跳转)
- [ ] Facebook登录 - 移动端
- [ ] Facebook登录 - Web端
- [ ] Apple登录 - iOS (需要真机测试)
- [ ] 邀请码传递 - 所有Provider
- [ ] 错误处理 - 用户取消、超时、无效state
- [ ] Token刷新流程

---

## Flutter对接指南

### 请求参数

```dart
// 移动端请求
https://dev-api.joyminis.com/auth/google/login?callback=joymini://oauth/callback&inviteCode=ABC123

// Web端请求
https://dev-api.joyminis.com/auth/google/login?redirect_uri=https://app.joyminis.com/oauth/callback&state=web_generated_state&inviteCode=ABC123
```

### 预期响应

#### 移动端

```
302重定向: joymini://oauth/callback?token=eyJhbGci...&refreshToken=eyJhbGci...
```

#### Web端

```
302重定向: https://app.joyminis.com/oauth/callback?token=eyJhbGci...&refreshToken=eyJhbGci...&state=web_generated_state
```

### Token验证

收到token后，Flutter应调用现有验证接口：

```
POST /api/v1/auth/oauth/google
Content-Type: application/json

{
  "idToken": "从Deep Link获取的token"
}
```

### 错误处理建议

1. **超时处理**: 设置60秒超时，超时后显示"登录超时，请重试"
2. **用户取消**: 检测到用户取消时静默处理
3. **网络错误**: 显示友好的网络错误提示
4. **Token无效**: 提示用户重新登录

---

## 常见问题

### Q1: Apple登录一直返回400 invalid_client错误

**A**: 确保Apple Client Secret正确生成。需要：

1. 正确的Team ID、Key ID和.p8私钥
2. 使用ES256算法签名JWT
3. JWT包含正确的iss、aud、sub声明

### Q2: Web端State验证失败

**A**: 检查：

1. Web端生成的state是否正确存储到sessionStorage
2. 后端是否从state参数中正确提取webState
3. sessionStorage是否可用（隐私模式下可能不可用）

### Q3: Deep Link未唤醒App

**A**: 检查：

1. AndroidManifest.xml中的intent-filter配置
2. Info.plist中的CFBundleURLSchemes配置
3. Deep Link格式：`joymini://oauth/callback?token=xxx`

### Q4: 邀请码未正确传递

**A**: 检查：

1. Flutter调用时是否传递inviteCode参数
2. 后端是否将inviteCode编码到state中
3. 回调时是否从state解码并使用inviteCode

### Q5: 生产环境配置

**A**: 确保：

1. 使用生产环境的Client ID/Secret
2. 配置正确的重定向URI（生产域名）
3. Apple OAuth需要在Apple Developer Console配置生产环境

---

## 更新日志

### v2.0 (2026-03-30)

- 企业级标准实施
- 平台感知架构（Web/移动端差异处理）
- State防CSRF攻击
- 邀请码支持
- Apple OAuth完整实现
- 详细的错误处理和监控

### v1.0 (初始版本)

- 基础OAuth Deep Link实现
- 多Provider支持
- Deep Link回调机制

---

## 支持与维护

### 问题反馈

- **开发问题**: 提交到GitHub Issues
- **生产问题**: 联系运维团队
- **配置问题**: 联系DevOps团队

### 监控指标

- OAuth成功率（按Provider）
- 平均登录时间
- 错误率（按错误类型）
- 用户取消率

### 定期检查

- 每月检查OAuth提供商配置
- 每季度更新依赖包
- 每半年审查安全配置

---

**文档维护者**: 后端开发团队  
**最后审阅**: 2026-03-30  
**下次审阅**: 2026-06-30

> **注意**: 本方案为生产就绪的企业级OAuth Deep Link方案，已在开发环境测试验证。部署到生产环境前请确保所有配置正确且经过完整测试。
