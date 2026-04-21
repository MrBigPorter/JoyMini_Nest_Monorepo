# 第三方登录文档

本目录包含Lucky Nest项目的第三方登录相关文档，已整理去重，只保留当前有效的文档。

## 文档结构

### 核心设计文档

- **[THIRD_PARTY_LOGIN_UNIFIED_SOLUTION_V2.md](THIRD_PARTY_LOGIN_UNIFIED_SOLUTION_V2.md)** - 第三方登录三端统一解决方案V2（不依赖Firebase）
  - 包含当前实施状态和架构设计

### 当前实施文档

- **[current-implementation/google-oauth-fix-summary.md](current-implementation/google-oauth-fix-summary.md)** - Google OAuth跨域问题修复总结
- **[current-implementation/deep-link-oauth-final-plan.md](current-implementation/deep-link-oauth-final-plan.md)** - Deep Link OAuth最终实施方案

### 指南文档

- **[guides/quick-start-guide.md](guides/quick-start-guide.md)** - OAuth快速实施指南

## 当前实施状态

### 博客系统第三方登录

- **Google OAuth**：使用后端标准endpoints (`/api/v1/auth/google/login`)
- **Facebook OAuth**：使用后端标准endpoints (`/api/v1/auth/facebook/login`)
- ⚠️ **GitHub OAuth**：已暂时移除，保留配置以备恢复
- 🔄 **Apple OAuth**：可选功能，暂未实现

### 架构设计

```
前端 (Next.js) → 标准HTTP客户端 → 后端API (/api/v1/auth/*) → 第三方OAuth提供商
    ↓
auth store ← 用户信息 ← 后端用户服务
```

## 关键特性

1. **无CORS问题**：使用Deep Link方案避免浏览器安全策略限制
2. **架构统一**：前后端分离，使用标准API调用
3. **用户信息获取**：通过`/api/v1/auth/profile`获取完整用户资料
4. **错误处理**：统一的错误处理和用户反馈机制
5. **维护简单**：减少前端复杂度，统一错误处理

## 相关文档

- **GitHub OAuth设置指南**：`../blog/development/GITHUB_OAUTH_SETUP_GUIDE.md`
- **Flutter OAuth集成指南**：`../read/features/FLUTTER_OAUTH_INTEGRATION_GUIDE.md`

## 更新历史

- **2026-04-16**：整理所有第三方登录文档到本目录
- **2026-04-16**：更新文档反映实际完成的改造工作
- **2026-04-16**：暂时移除GitHub登录，简化系统

## 运维参考

### 监控要点

1. **API健康状态**：监控`/api/v1/auth/*` endpoints的可用性
2. **登录成功率**：跟踪Google和Facebook OAuth的成功率
3. **错误日志**：监控OAuth流程中的错误和异常

### 故障排除

1. **OAuth登录失败**：检查后端服务状态和第三方OAuth配置
2. **用户信息获取失败**：验证JWT token有效性和API响应
3. **重定向问题**：检查sessionStorage和路由配置
