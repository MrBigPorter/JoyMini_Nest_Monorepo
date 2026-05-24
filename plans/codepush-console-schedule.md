# CodePush Console — 开发排期

> 按阶段划分，每个阶段有明确的交付物和前后置依赖。
> 不估算时间，只排定依赖顺序。

---

## 一、依赖关系图

```
第 1 阶段: 项目骨架
  ├── 1.1 初始化 monorepo + NestJS BFF 骨架
  ├── 1.2 初始化 Vite + React SPA 骨架
  ├── 1.3 Prisma schema + SQLite
  └── 1.4 Docker + Nginx 配置
       │
       ▼
第 2 阶段: BFF 后端
  ├── 2.1 Auth 模块 (注册/登录/JWT)
  ├── 2.2 Server 模块 (CRUD + 凭据管理)
  ├── 2.3 Proxy 模块 (转发到 CodePush API)
  ├── 2.4 ApiKey 模块
  └── 2.5 AuditLog 模块
       │
       ▼
第 3 阶段: 前端页面 (依赖第 2 阶段的 API)
  ├── 3.1 注册/登录页面
  ├── 3.2 服务器管理页面
  ├── 3.3 Dashboard 概览页
  ├── 3.4 App 管理页面
  ├── 3.5 Deployment 管理页面
  ├── 3.6 Release 上传/回滚页面
  ├── 3.7 Promote 功能
  ├── 3.8 Access Key 管理页面
  ├── 3.9 审计日志页面
  └── 3.10 设置页面 (API 密钥)
       │
       ▼
第 4 阶段: i18n + 异常处理 (可并行)
  ├── 4.1 中文语言包
  ├── 4.2 英文语言包
  └── 4.3 异常处理 + 状态覆盖
       │
       ▼
第 5 阶段: 部署 + 文档
  ├── 5.1 docker-compose 最终验证
  ├── 5.2 README 中英文
  └── 5.3 MIT License + GitHub 初始化
```

---

## 二、阶段详情

### 第 1 阶段：项目骨架搭建

| 编号 | 任务 | 前置 | 交付物 |
|------|------|------|--------|
| 1.1 | 初始化 monorepo (packages/apps/server + apps/web) | 无 | root package.json + tsconfig |
| 1.2 | NestJS 项目初始化 + Prisma 集成 + SQLite | 1.1 | BFF 骨架可启动 |
| 1.3 | Vite + React + Shadcn/ui 项目初始化 | 1.1 | SPA 骨架可启动，能看到空白页面 |
| 1.4 | 路由骨架 (react-router): /login /register /dashboard /servers /apps /audit-logs /settings | 1.3 | 路由可跳转，页面占位 |
| 1.5 | Dockerfile (BFF + Web) + nginx.conf + docker-compose.yml | 1.2, 1.3 | `docker compose up` 可启动 |

### 第 2 阶段：BFF 后端核心

| 编号 | 任务 | 前置 | 交付物 |
|------|------|------|--------|
| 2.1 | Prisma User model + AuthController + AuthService + JWT Strategy | 1.2 | 可注册/登录/获取用户信息 |
| 2.2 | Prisma Server model + ServersController + ServersService | 2.1 | 服务器 CRUD API |
| 2.3 | Prisma AuditLog model + ProxyController + ProxyService | 2.2 | 代理转发到 CodePush API + 审计日志记录 |
| 2.4 | Prisma ApiKey model + ApiKeyController + ApiKeyService | 2.1 | API 密钥生成/列表/删除 |
| 2.5 | Swagger 文档配置 | 2.1-2.4 | 访问 /api/docs 看到 API 文档 |

### 第 3 阶段：前端核心页面

| 编号 | 任务 | 前置 | 交付物 |
|------|------|------|--------|
| 3.1 | 布局组件: Sidebar + Header + 内容区 | 1.4 | 导航框架 |
| 3.2 | 注册页 + 登录页 + 路由守卫 | 2.1, 3.1 | 可注册登录 |
| 3.3 | 服务器管理页面 (列表 + 添加/编辑/删除/测试连接) | 2.2, 3.2 | 可管理服务器 |
| 3.4 | Dashboard 概览页 (统计卡片 + 最近操作 + 快速操作) | 2.5, 3.2 | 首页数据展示 |
| 3.5 | App 管理页面 (卡片列表 + 创建/编辑/删除) | 2.3, 3.2 | 可管理 App |
| 3.6 | Deployment 管理页面 (卡片列表 + 创建/删除) | 3.5 | 可管理 Deployment |
| 3.7 | Release 列表 + 上传弹窗 + 回滚弹窗 | 3.6 | 可上传/回滚 Release |
| 3.8 | Promote 弹窗 | 3.7 | 可晋升版本 |
| 3.9 | Access Key 管理页面 | 3.5 | 可管理 Access Key |
| 3.10 | 审计日志页面 (时间线 + 筛选) | 2.3, 3.2 | 可查看操作历史 |
| 3.11 | 设置页面 (API 密钥 + 个人信息) | 2.4, 3.2 | 可管理 API 密钥 |

### 第 4 阶段：i18n + 异常处理

| 编号 | 任务 | 前置 | 交付物 |
|------|------|------|--------|
| 4.1 | 中文语言包 (所有页面) | 3.1-3.11 | 中文界面 |
| 4.2 | 英文语言包 (所有页面) | 3.1-3.11 | 英文界面 |
| 4.3 | 网络错误处理 (Toast + 重试按钮) | 2.1-2.5 | 网络异常友好提示 |
| 4.4 | Token 过期自动跳转登录 | 2.1 | 401 自动跳转 |
| 4.5 | Loading/Empty/Error 全状态覆盖 | 3.1-3.11 | 所有页面无白屏 |

### 第 5 阶段：部署 + 文档

| 编号 | 任务 | 前置 | 交付物 |
|------|------|------|--------|
| 5.1 | docker-compose 最终测试 (clean build + up) | 1.5, 2.1-2.5, 4.1-4.5 | 一键启动验证 |
| 5.2 | README 中文版 (项目说明 + 部署指南 + 截图) | 5.1 | 中文文档 |
| 5.3 | README 英文版 | 5.1 | 英文文档 |
| 5.4 | MIT License + .gitignore + GitHub CI (lint + typecheck) | 5.2, 5.3 | 仓库初始化 |

---

## 三、任务依赖关系 - 关键路径

```
1.1 → 1.2 → 2.1 → 2.2 → 2.3 → 3.5 → 3.6 → 3.7 → 3.8
                                              └→ 3.9
                         2.4 → 3.11
                         2.5 → 3.4
 1.1 → 1.3 → 1.4 → 3.1 → 3.2 ──→ 3.3
                                  └→ 3.10
                                   3.4
                                   3.5 ──→ ...

 1.1 → 1.5 ──────────────────────────────────────→ 5.1 → 5.2/5.3/5.4
```

**关键路径（Critical Path）：**
```
1.1 → 1.2 → 2.1 → 2.2 → 2.3 → 3.5 → 3.6 → 3.7 → 3.8 → 4.1/4.2 → 5.1 → 5.2
```

这条路径上的任务不能并行，必须按顺序完成。

**可并行的任务：**
- 3.3 (服务器管理) 可以和 3.4 (Dashboard) 并行
- 3.9 (Access Key) 可以和 3.7 (Release) 并行
- 3.10 (审计日志) 可以和 3.5-3.8 并行
- 4.1 (中文) 和 4.2 (英文) 可以并行
- 4.3-4.5 (异常处理) 可以和 4.1-4.2 并行

---

## 四、里程碑

| 里程碑 | 对应阶段 | 可验证的标准 |
|--------|---------|-------------|
| M1: 项目跑起来 | 第 1 阶段 | `docker compose up` 后能看到登录页 |
| M2: API 可用 | 第 2 阶段 | 可用 curl 注册/登录/管理服务器/代理调用 CodePush |
| M3: 核心功能可用 | 第 3 阶段 | 可用 UI 完成: 添加服务器 → 创建 App → 上传 Release |
| M4: 完整产品 | 第 4 阶段 | 中英文切换 + 所有异常状态有处理 |
| M5: 可发布 | 第 5 阶段 | GitHub 仓库就绪，有 README，可被他人部署使用 |

---

## 五、可选的后续扩展（不在当前范围内）

这些是项目完成后可以考虑的功能，目前不纳入排期：

| 功能 | 说明 |
|------|------|
| 团队协作 | 邀请成员加入，分配权限 (admin/member) |
| Webhook 通知 | Release 发布后通知 Slack/钉钉/企业微信 |
| 多 CodePush 版本兼容 | 适配不同版本的 lisong/code-push-server API |
| Release 对比 | 对比两个版本的 bundle 差异 |
| 批量操作 | 批量 Promote、批量回滚 |
| CI/CD 集成文档 | GitHub Actions / GitLab CI 示例 |
| 自动更新检测 | 定期检查 CodePush 服务器健康状态 |
