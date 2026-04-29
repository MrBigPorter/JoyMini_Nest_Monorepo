# 技术文档自动发布计划

## 目标
将 `docs/blog/` 下的技术文档优化为博客文章，通过脚本自动发布到 blog.joyminis.com。

## 现状分析

### 现有脚本
[`scripts/batch-import-blog-articles.ts`](../scripts/batch-import-blog-articles.ts)
- 从 `docs/blog/articles/` 读取 `.md` 文件
- 解析格式：`# 标题` + `> 摘要` + `---` + 正文
- 通过 API (`POST /admin/blog/articles`) 创建文章
- 交互式输入 API 地址、管理员账号密码
- 支持 PUBLISHED / DRAFT 状态

### 现有文章（已发布）
- `nextjs-bundle-size-optimization-practice.md` — 打包体积优化
- `react-hls-cross-component-coordination.md` — HLS 跨组件协调
- `yarn-pnp-monorepo-ci-caching.md` — CI 缓存

### 文档目录结构（已按类型分类）
```
docs/blog/
├── architecture/    → 架构设计（11 篇）
├── caching/         → 缓存（1 篇 — 本次对话产出）
├── security/        → 安全（7 篇）
├── design/          → 设计规范（5 篇）
├── development/     → 开发指南（10 篇）
├── features/        → 功能说明（2 篇）
├── i18n/            → 国际化（3 篇）
├── articles/        → 已发布文章（3 篇）
└── plans/           → 开发计划（不发布）
```

### 需要优化的点
内部文档 → 博客文章需要：
1. 移除内部文件路径引用（如 `apps/frontend-blog/open-next.config.ts`）
2. 将 Mermaid 图表转为文字描述或截图
3. 添加背景上下文（让外部读者能理解）
4. 提炼技术深度，保持可读性
5. 添加引人入胜的导语和总结
6. 补充"适用场景"和"相关阅读"

---

## 执行步骤

### Step 1: 写第一篇博客文章 — 缓存架构实践
**输入**：[`docs/blog/caching/BLOG_CACHING_ARCHITECTURE.md`](../docs/blog/caching/BLOG_CACHING_ARCHITECTURE.md)

**输出**：`docs/blog/articles/blog-caching-architecture-practice.md`

**改动内容**：
- 改为面向外部读者的技术博客风格
- 替换 Mermaid 图表为文字描述
- 移除内部路径引用，改为通用描述
- 移除变更历史等内部元数据
- 添加"背景"章节说明为什么需要三层缓存
- 添加对比数据（HIT vs MISS 时间对比）

### Step 2: 增强批量导入脚本
**输入**：[`scripts/batch-import-blog-articles.ts`](../scripts/batch-import-blog-articles.ts)

**改动内容**：
- 支持非交互式模式（通过环境变量传参），便于自动化
- 支持从任意目录扫描，保留目录结构信息
- 添加 `categoryId` 字段支持（按子目录映射到博客分类）
- 添加 `tags` 字段支持
- 添加 `--dry-run` 参数预览将要发布的文章

### Step 3: 添加 Makefile 命令
**改动**：[`Makefile`](../Makefile)

**改动内容**：
- 添加 `publish-blog-docs` 目标
- 支持 `PUBLISH_STATUS=DRAFT` 环境变量（先存草稿检查再发布）

### Step 4: 发布并验证
- 运行 `tsx scripts/batch-import-blog-articles.ts` 发布到生产环境
- 登录 admin 后台检查文章格式
- 确认自动翻译（英文）是否正常

---

## 技术方案细节

### 脚本增强 — 非交互式模式

```typescript
// 新增环境变量支持
const apiBase = process.env.API_URL || defaultApiUrl;
const username = process.env.ADMIN_USERNAME;  // 如果不提供则交互式输入
const password = process.env.ADMIN_PASSWORD;
const status = (process.env.PUBLISH_STATUS as "DRAFT" | "PUBLISHED") || "PUBLISHED";
const sourceDir = process.env.SOURCE_DIR || "docs/blog/articles";
```

### 脚本增强 — 分类映射

```typescript
const CATEGORY_MAP: Record<string, string> = {
  architecture: "架构设计",
  caching: "性能优化",
  security: "安全实践",
  design: "设计规范",
  development: "开发指南",
  features: "功能介绍",
  i18n: "国际化",
  articles: "技术博客",
};
```

### API 增强
当前创建文章的 payload 不包含 categoryId，需要确认 API 是否支持。如果不支持，可以先发布为 DRAFT 再手动分类。
