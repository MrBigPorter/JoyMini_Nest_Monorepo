# 剩余文章写作计划

> 依据 `full-writing-plan.md` 剩余 10 篇未写文章
> 按优先级 + 源码可获取性排序

---

## 阶段一：admin-next 6 篇（源码在当前仓库）

| # | 文章 | 优先级 | 源码位置 | 预计行数 |
|---|------|-------|---------|---------|
| A12 | UI 组件库 12 组件 | ⭐⭐⭐ | [`src/components/UIComponents.tsx`](../../apps/admin-next/src/components/UIComponents.tsx) 631L | ~800 行 |
| A3 | Server Prefetch + ISR | ⭐⭐⭐ | [`src/lib/serverFetch.ts`](../../apps/admin-next/src/lib/serverFetch.ts) + `src/lib/actions/` | ~400 行 |
| A15 | 路由配置体系 | ⭐⭐⭐ | [`src/routes/index.ts`](../../apps/admin-next/src/routes/index.ts) 164L | ~300 行 |
| A14 | LanguageProvider | ⭐⭐⭐ | [`src/hooks/LanguageProvider.tsx`](../../apps/admin-next/src/hooks/LanguageProvider.tsx) 148L | ~300 行 |
| A16 | BuildInfo + 工具函数 | ⭐⭐ | [`src/lib/build-info.ts`](../../apps/admin-next/src/lib/build-info.ts) + [`src/constants.ts`](../../apps/admin-next/src/constants.ts) | ~250 行 |
| A13 | Browser crypto shim | ⭐⭐⭐ | [`src/lib/crypto-shim.ts`](../../apps/admin-next/src/lib/crypto-shim.ts) 56L | ~200 行 |

## 阶段二：Flutter 4 篇（需 Flutter 源码，不在当前仓库）

| # | 文章 | 优先级 | 说明 |
|---|------|-------|------|
| F24 | MotionX 动画扩展 + WiggleOnTap | ⭐⭐⭐ | 需 Flutter 项目源码 |
| F25 | EventBus 单例事件总线 + GlobalEvent 类型体系 | ⭐⭐⭐ | 需 Flutter 项目源码 |
| F26 | FirebaseService 统一认证层 + 超时保护 | ⭐⭐⭐ | 需 Flutter 项目源码 |
| F27 | UserStore/WalletStore/ConfigStore Hydrated 三件套 | ⭐⭐⭐ | 需 Flutter 项目源码 |

---

## 执行顺序

### 第一批：admin-next 文章

1. **A12: UI 组件库** — 12 个组件：Button/Card/Modal/Input/Select/Switch/Badge/Toast/Dropdown/ImageUpload/Breadcrumbs/DateRangePicker
2. **A3: Server Prefetch + ISR** — serverGet 工具、revalidate 策略、tags 精准失效、401/403 降级
3. **A15: 路由配置体系** — RouteConfig 类型、8 个路由组、lucide-react 图标映射、hidden 路由
4. **A14: LanguageProvider** — next-intl 桥接、setLocale cookie 写入、向后兼容层
5. **A16: BuildInfo + 工具函数** — 构建信息展示、commit SHA、deployedAt 格式化
6. **A13: Browser crypto shim** — Web Crypto API 在浏览器端模拟 node:crypto

### 第二批：Flutter 文章（待获取 Flutter 源码后执行）

7-10. F24-F27

---

## 文章规格

严格遵循 [`ARTICLE_AUTHORING_STANDARD.md`](../../docs/blog/development/ARTICLE_AUTHORING_STANDARD.md) v2.0.0：

- **散文语言**: 中文（Rule 8）
- **代码注释**: 英文（Rule 2）  
- **图表标签**: 英文（Rule 3）
- **编号章节**: `## 1.` / `## 2.` / `### 2.1`（Style Guide 3.1）
- **总结章节**: `## N. 总结`（Style Guide 3.4）
- **YAML frontmatter**: title/description/slug/tags/createdAt 完整（Rule 1）
- **slug**: 匹配文件名（Rule 5）
- **标签**: 匹配现有分类法（Rule 6）
- **零中文代码块**: 代码块内无中文（Rule 7）
- **英文冒号**: 标题中使用英文 `:` 而非中文 `：`（Common Mistake #8）
