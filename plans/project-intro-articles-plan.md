# 4 个项目介绍文章计划

> 求职展示用博客文章，配合录屏展示项目
> 中文撰写（自动翻译多语言），存入 `docs/blog/articles/`

---

## 文章概览

| # | 文章标题 | 项目 | 核心定位 | 目标读者印象 |
|---|---------|------|---------|------------|
| P1 | JoyMini Super App — Flutter 驱动的社交电商平台 | JoyMini_Flutter_App | 全功能移动端超级 App | 架构设计能力 + Flutter 深度 |
| P2 | JoyMini API — 企业级 NestJS 后端架构实践 | API NestJS | 高可用后端基础设施 | 后端架构能力 + 安全设计 |
| P3 | JoyMini Admin — Next.js 智能管理后台 | admin-next | 现代化运营管理平台 | 全栈能力 + 复杂业务理解 |
| P4 | JoyMini Blog — 多语言博客平台的 SSG/SSR/ISR 实践 | frontend-blog | 高性能内容平台 | 性能优化 + DevOps + 国际化 |

---

## P1: JoyMini Super App — Flutter 驱动的社交电商平台

**文件名:** `docs/blog/articles/projects/joymini-flutter-super-app.md`
**核心分类:** `projects`, `flutter`

### 结构大纲

```
一、项目概述
   - 一句话定位：社交 + 电商 + 通讯 + 娱乐一体化的超级 App
   - 用户规模/功能规模一句话总结

二、技术架构总览
   - 架构图：Riverpod + GoRouter + Dio + HydratedStorage
   - 关键数据流：状态管理、路由、网络、持久化
   - （录屏建议：展示项目目录结构、pubspec.yaml 关键依赖）

三、核心功能模块详解
   3.1 即时通讯系统
     - WebRTC 音视频通话 + CallKit 集成
     - ChatService 完整消息体系
     - （录屏建议：展示 IM 聊天、发起通话、消息类型）
   
   3.2 LuckyDraw 抽奖系统
     - 组团抽奖 + 机器人填充 + 超时处理
     - Redis 分布式锁保障并发安全
     - （录屏建议：展示开奖流程、组团页面）
   
   3.3 KYC 实名认证
     - OCR 身份证识别 + 活体检测
     - AWS Rekognition + Gemini AI 双重验证
     - （录屏建议：展示 KYC 流程、上传证件、活体检测）
   
   3.4 电商功能
     - 产品浏览 + 下单 + 支付
     - 钱包系统（充值/提现/交易记录）
     - （录屏建议：展示商品列表、下单流程、钱包页面）

四、关键技术亮点
   4.1 AppBootstrap 5 路并行初始化 + 数据屏障
   4.2 UnifiedInterceptor 错误策略分发 + 单飞 Token 刷新
   4.3 ApiCacheManager 双存储 + SWR 缓存策略
   4.4 Design Tokens 生成系统（颜色/间距/字体）
   4.5 DeviceFingerprint 设备指纹 + 风控体系
   4.6 Deep Link OAuth + GlobalOAuthHandler
   4.7 GoRouter ShellRoute + RouteAuthConfig 路由守卫
   4.8 GlobalUploadService S3 直传 + 压缩管道

五、离线与性能优化
   - OfflineQueueManager + ApiCacheManager
   - ImageCacheManager L1/L2 双缓存
   - （录屏建议：展示离线模式、切飞机模式）

六、AI 与 WEB3 扩展方向
   - 现有 AI 能力：KYC OCR、内容审核
   - 未来规划：AI 聊天助手、RAG 客服、加密支付

七、技术栈总结
   - Flutter / Riverpod / GoRouter / Dio
   - WebRTC / Firebase / AWS Rekognition
   - Redis / BullMQ / PostgreSQL
```

---

## P2: JoyMini API — 企业级 NestJS 后端架构实践

**文件名:** `docs/blog/articles/projects/joymini-api-nestjs.md`
**核心分类:** `projects`, `backend`

### 结构大纲

```
一、项目概述
   - 定位：支撑 4 个前端应用的统一后端平台
   - 模块数 / API 数 / 数据库表数

二、技术架构总览
   - NestJS 模块化架构 + Prisma + Redis + BullMQ
   - 架构图：Controller → Service → Prisma → PostgreSQL
   - （录屏建议：展示项目目录结构、各 Module 组织方式）

三、核心业务模块
   3.1 用户与认证系统
     - JWT + Refresh Token 双令牌
     - AdminJwtAuthGuard + RolesGuard 权限体系
     - KYC 多级认证（基础/高级/活体）
     - （录屏建议：展示认证流程、权限拦截效果）
   
   3.2 即时通讯服务
     - ChatService 完整消息体系（文字/图片/语音/视频）
     - WebRTC ICE Server 集成
     - 消息撤回/删除/已读/转发
     - （录屏建议：展示 WebSocket 通信、消息流转）
   
   3.3 群组与抽奖系统
     - GroupService：开团 + 拼团 + 超时处理
     - 分布式锁保障并发安全（RedisLockService）
     - 机器人自动填充策略
     - （录屏建议：展示群组创建、抽奖流程日志）
   
   3.4 金融系统
     - 订单系统（充值/提现/退款）
     - 钱包事务 + 余额变更记录
     - 支付渠道管理
     - （录屏建议：展示订单创建、钱包操作）

四、基础设施与中间件
   4.1 RedisLockService 分布式锁
     - Redlock 算法实现
     - 自动续期 + 死锁检测
   4.2 MediaProcessor 媒体处理管道
     - 图片压缩 + 视频转码（FFmpeg）
     - BullMQ 队列 + 并发控制
   4.3 AvatarProcessor 头像合成
     - 群组头像自动生成 + 组合
   4.4 AllExceptionsFilter 统一异常处理
     - 结构化错误响应 + 多环境适配

五、安全体系
   - RecaptchaService reCAPTCHA v3
   - SensitiveWordFilter 敏感词过滤（DFA 算法）
   - 速率限制 + CORS + CSRF
   - OTP 时序安全攻击防护
   - SQL 注入/XSS 防护
   - （录屏建议：展示安全拦截日志、reCAPTCHA 验证）

六、AI 能力
   - Gemini AI 集成：KYC OCR、文章翻译、内容审核
   - AI Service 封装层
   - （录屏建议：展示 KYC OCR 识别效果、翻译接口调用）

七、性能与扩展性
   - 连接池 + 查询优化
   - BullMQ 队列系统
   - 水平扩展设计

八、技术栈总结
   - NestJS / Prisma / PostgreSQL / Redis
   - BullMQ / FFmpeg / Gemini AI
   - Docker / GitHub Actions / GitLab CI
```

---

## P3: JoyMini Admin — Next.js 智能管理后台

**文件名:** `docs/blog/articles/projects/joymini-admin-nextjs.md`
**核心分类:** `projects`, `frontend`

### 结构大纲

```
一、项目概述
   - 定位：JoyMini 全平台统一运营管理后台
   - 覆盖的业务模块数

二、技术架构总览
   - Next.js 14 App Router + Zustand + TanStack Query
   - 架构图：Page → SmartTable → Cache Contract → API
   - （录屏建议：展示项目结构、路由组织方式）

三、核心功能模块
   3.1 仪表盘
     - 关键指标统计 + 趋势图表
     - （录屏建议：展示 Dashboard 页面）
   
   3.2 用户管理
     - 用户列表 + 搜索/筛选/排序
     - 用户详情 + 设备信息 + 操作记录
     - KYC 审核流程
     - （录屏建议：展示用户列表搜索、KYC 审核弹窗）
   
   3.3 订单与财务管理
     - 订单管理 + 退款处理
     - 充值/提现/交易记录
     - 审核流程 + 状态流转
     - （录屏建议：展示订单列表、审核操作）
   
   3.4 商品与营销
     - 商品管理 + Banner 配置
     - 优惠券 + 秒杀活动
     - 幸运抽奖配置
     - （录屏建议：展示商品编辑、抽奖配置）
   
   3.5 系统管理
     - 管理员管理 + 操作日志
     - 系统配置 + 多语言配置
     - 推送通知管理
     - （录屏建议：展示配置页面、日志查看）

四、关键技术亮点
   4.1 SmartTable 通用 CRUD 组件
     - 统一表格 + 搜索 + 分页 + 导出
     - 适配所有列表页的一致体验
     - （录屏建议：展示 SmartTable 在多个页面的表现）
   
   4.2 缓存契约模式
     - 12+ 缓存模块统一模式
     - SearchParams 解析 + 查询 Key 构建
     - TanStack Query + serverFetch 双端缓存
     - （录屏建议：展示缓存代码模式、实际缓存效果）
   
   4.3 认证与安全
     - Middleware JWT 验证 + Token 刷新
     - CSRF Token + XSS 防护 + SQL 注入检测
     - 敏感数据脱敏（手机/邮箱/身份证）
     - （录屏建议：展示 JWT 过期自动刷新）
   
   4.4 Sentry 全链路追踪
     - withAppSpan / withSsrSpan / withUiActionSpan
     - 请求级 Tracing
     - （录屏建议：展示 Sentry 性能面板）

五、UI/UX 设计
   - Framer Motion 动画系统
   - 暗黑/明亮主题切换
   - 响应式侧边栏 + 移动端适配
   - 多语言 i18n 支持
   - （录屏建议：展示主题切换、动画效果）

六、技术栈总结
   - Next.js 14 / TypeScript / Tailwind CSS
   - Zustand / TanStack Query / axios
   - Framer Motion / Sentry / Cloudflare Workers
```

---

## P4: JoyMini Blog — 多语言博客平台的 SSG/SSR/ISR 实践

**文件名:** `docs/blog/articles/projects/joymini-blog-platform.md`
**核心分类:** `projects`, `frontend`, `devops`

### 结构大纲

```
一、项目概述
   - 定位：多语言技术博客 + PWA 内容平台
   - 6 语言支持 + 全球 CDN 分发

二、技术架构总览
   - Next.js App Router + Cloudflare Workers/Pages
   - 架构图：请求 → CDN → Cloudflare Worker → SSR/ISR → 缓存
   - （录屏建议：展示项目结构、部署架构图）

三、渲染策略详解
   3.1 SSG 首页 + SSG 分类/标签页
     - 构建时预渲染，CDN 边缘缓存
     - （录屏建议：展示 SSG 页面加载速度）
   
   3.2 ISR 文章详情页
     - 按需重新验证 + Cloudflare Queue 刷新
     - Stale-While-Revalidate 策略
     - （录屏建议：展示 ISR 刷新过程、缓存效果）
   
   3.3 SSR 个性化页面
     - 用户相关页面服务端渲染
     - 认证状态判断

四、核心功能模块
   4.1 文章系统
     - 文章列表 + 详情 + 搜索
     - 分类/标签/归档
     - 相关文章推荐
     - （录屏建议：展示文章浏览、搜索功能）
   
   4.2 多语言支持
     - 6 个 locale（ko/en/zh-CN/zh-TW/ja/vi/th）
     - 自动翻译管道（Gemini API + BullMQ）
     - 翻译进度管理
     - （录屏建议：展示多语言切换、翻译效果）
   
   4.3 用户系统
     - 邮箱/手机/Google/Facebook 多种登录
     - 书签功能 + 点赞
     - （录屏建议：展示登录流程、书签功能）
   
   4.4 PWA 支持
     - Service Worker + 离线缓存
     - 安装引导 + 更新通知
     - 骨架屏加载
     - （录屏建议：展示 PWA 安装、离线访问）

五、性能优化
   - Core Web Vitals 指标：LCP/TBT/CLS
   - 图片优化 + 懒加载 + Blurhash
   - CDN 缓存策略 + 边缘计算
   - 通用 Fetcher 适配层（CSR/SSG/SSR）
   - （录屏建议：展示 Lighthouse 评分）

六、DevOps 实践
   - Cloudflare Workers/Pages 部署
   - GitHub Actions + GitLab CI 双平台
   - Lighthouse CI 性能审计
   - 自动翻译 Pipeline
   - （录屏建议：展示 CI/CD 流程、部署日志）

七、技术栈总结
   - Next.js 14 / TypeScript / Tailwind CSS
   - Cloudflare Workers / Pages / Queues
   - TanStack Query / Zustand
   - PWA / Service Worker / IndexedDB
```

---

## 分类标签建议

所有文章统一使用分类和标签：

```
分类: Projects
标签: project-showcase, portfolio
```

并在 `docs/blog/articles/projects/` 目录下归档。

---

## 写作规范

1. **中文撰写** — 利用已有翻译管道自动翻译多语言
2. **技术深度** — 每个功能点说明"为什么这么做"而非"做了什么"
3. **架构图** — 使用 Mermaid 图表展示架构
4. **代码示例** — 核心代码片段（非完整文件）
5. **录屏提示** — 用 `> 🎥 录屏建议：...` 标注
6. **每篇 2000-4000 字** — 够深但不过长

---

## 执行顺序

1. ✅ P4 JoyMini Blog（最熟悉，bootstrap 快）
2. ✅ P3 JoyMini Admin（次熟悉）
3. ✅ P2 JoyMini API（需要深度梳理模块）
4. ✅ P1 JoyMini Flutter App（已经深度扫描过，素材最多）
