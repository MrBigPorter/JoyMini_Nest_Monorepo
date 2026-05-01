# Update About Page & Blog Article for New Optimizations

## Context

After adding homepage optimizations (Local-First Offline with IndexedDB, PWA Service Worker caching, View Transitions, Network-Aware Adaptive Quality, Hover Pre-fetch, Cross-Component Video Coordination), two documents need updating:

1. **About Page** — [`apps/frontend-blog/src/app/[locale]/about/page.tsx`](apps/frontend-blog/src/app/[locale]/about/page.tsx) — The "About Us" page on the blog website, which displays the project's tech stack.
2. **Blog Article** — [`docs/blog/articles/projects/joymini-blog-platform.md`](docs/blog/articles/projects/joymini-blog-platform.md) — The published blog article that introduces the blog platform project.

---

## Part 1: Update About Page Tech Stack

### What's Missing

The [`techStackGroups`](apps/frontend-blog/src/app/[locale]/about/page.tsx:34) array in the About page's Frontend category currently only shows:

| Current | Missing |
|---------|---------|
| Next.js 15 | **TanStack Query** — core data fetching/caching layer |
| React 19 | **Dexie.js** — IndexedDB wrapper for Local-First |
| TypeScript | **PWA / Service Worker** — offline access |
| Tailwind CSS | **View Transitions API** — page transition animations |

### Changes Required

#### 1. Add new tech items to `techStackGroups` frontend category

Insert after the existing 4 items in [`page.tsx:39-44`](apps/frontend-blog/src/app/[locale]/about/page.tsx:39):

```typescript
{ name: 'TanStack Query', icon: '🔄', descriptionKey: 'techTanstackQuery' },
{ name: 'Dexie.js', icon: '📦', descriptionKey: 'techDexie' },
{ nameKey: 'techPwa', icon: '📲', descriptionKey: 'techPwaDesc' },
{ nameKey: 'techViewTransitions', icon: '✨', descriptionKey: 'techViewTransitionsDesc' },
```

#### 2. Add translation keys in 6 locale files

Add these new keys to **all 6 locale files** (`zh.json`, `en.json`, `ko.json`, `ja.json`, `fr.json`, `de.json`):

```
"techTanstackQuery": "ZH: React数据获取与缓存 / EN: React data fetching & caching"
"techDexie": "ZH: IndexedDB本地数据库 / EN: IndexedDB local database wrapper"
"techPwa": "ZH: PWA离线支持 / EN: PWA offline support"
"techPwaDesc": "ZH: Service Worker离线缓存 / EN: Service Worker offline caching"
"techViewTransitions": "ZH: View Transitions / EN: View Transitions"
"techViewTransitionsDesc": "ZH: 页面过渡动画 / EN: Page transition animations"
```

> **Note:** For `ko`, `ja`, `fr`, `de` — use the English descriptions as fallback until proper translations are provided.

---

## Part 2: Update Blog Article (joymini-blog-platform.md)

### Issues Found

| Area | Current Content | Needs Update |
|------|----------------|--------------|
| Title/Frontmatter | `Next.js 14` | `Next.js 15` |
| Core Data (L1) | LCP < 500ms for SSG | Keep (still accurate), but add offline FCP metric |
| Section 2.2 Tech Stack | No Dexie.js, no PWA framework | Add Dexie.js, next-pwa/Workbox |
| Section 4.4 PWA | Minimal (1 code snippet + 4 bullets) | Expand with full caching strategy, useOffline hook, OfflineIndicator |
| Missing Section | No Local-First architecture | Add new section before "Performance" |
| Missing Section | No View Transitions | Mention in Performance or as standalone note |
| Missing Section | No Network-Aware Adaptive Quality | Add under Performance |
| Missing Section | No Homepage Optimizations | Add brief mention |
| Section 5.1 Core Web Vitals | LCP < 1.5s | Update to `< 1.2s` |
| Section 7.0 Summary Table | Missing Dexie.js, View Transitions | Add rows |

### Detailed Changes

#### Change 1: Frontmatter

```diff
- title: "JoyMini Blog — 多语言博客平台的 SSG/SSR/ISR 混合渲染实践"
- description: "基于 Next.js 14 + Cloudflare 构建..."
+ title: "JoyMini Blog — 多语言博客平台的 SSG/SSR/ISR + Local-First 离线架构实践"
+ description: "基于 Next.js 15 + Cloudflare 构建的高性能多语言技术博客平台，支持 6 种语言、PWA Local-First 离线访问、AI 自动翻译管道"
```

Also update tags:
```diff
- tags: [project-showcase, portfolio, nextjs, cloudflare, ssg, ssr, isr, pwa, i18n]
+ tags: [project-showcase, portfolio, nextjs, cloudflare, ssg, ssr, isr, pwa, i18n, indexeddb, offline-first]
```

#### Change 2: Core Data (Section 1)

```diff
  **核心数据：**
  - 6 个语言版本并行运营
  - SSG 首页首屏加载 < 500ms（全球平均）
- - Lighthouse Performance 评分 > 95
+ - Lighthouse Performance 评分 > 95（目标 < 1.2s LCP）
  - PWA 支持离线阅读
+ - Local-First 架构：IndexedDB 作为第一数据层，离线 FCP < 200ms
  - 自动翻译管道（Gemini API + BullMQ 队列）日均处理数百篇文章
```

#### Change 3: Update Section 2.2 Tech Stack Table

Add rows to the table:

```diff
  | 框架 | Next.js 14 App Router → **Next.js 15** | ... |
+ | 离线存储 | Dexie.js + IndexedDB | Local-First 离线架构，首页数据即时加载 |
+ | PWA | next-pwa + Workbox | 5 种缓存策略，NetworkFirst 导航路由 |
+ | 动画 | Framer Motion | 声明式动画 + **View Transitions API** |
```

#### Change 4: Expand Section 4.4 PWA (Major Rewrite)

Replace the minimal PWA section with comprehensive content:

- Caching strategies table (5 strategies: NetworkFirst for navigation, CacheFirst for static assets, StaleWhileRevalidate for API, NetworkOnly for mutations, CacheFirst for fonts/images)
- `useOffline` hook explanation
- `OfflineIndicator` component
- `NEXT_PWA_ENABLE` dev mode
- Update notification mechanism

#### Change 5: Add New Section — "Local-First Offline Architecture" (Before Performance section)

New section covering:
- 4-tier cache architecture diagram (IndexedDB → SW → Edge CDN → Browser)
- Dexie.js schema (5 tables: articles, articleContents, categories, tags, metadata)
- Data flow: App loads → IndexedDB cache hit → Render immediately → Sync background update
- Homepage optimizations table

#### Change 6: Add View Transitions & Adaptive Quality to Performance Section

Under Section 5, add:
- View Transitions API page transitions (< 100ms)
- Network-aware adaptive quality (`useNetworkQuality` hook)
- Hover pre-fetch for instant navigation

#### Change 7: Update Section 5.1 Core Web Vitals

```diff
  | 指标 | 目标 | 实现策略 |
  |------|------|---------|
- | LCP | < 1.5s | ... |
+ | LCP | < 1.2s | 图片优化 + Blurhash + 预加载 + 优先缓存 |
+ | 离线 FCP | < 200ms | IndexedDB Local-First 即时加载 |
```

#### Change 8: Update Section 7 Summary Table

```diff
  | **缓存** | TanStack Query | 服务端数据缓存 + 乐观更新 |
+ | **离线存储** | Dexie.js + IndexedDB | Local-First 离线架构 |
+ | **动画** | Framer Motion + View Transitions | 页面过渡动画 |
```

---

## Files to Modify (Summary)

| # | File | Change Type | Description |
|---|------|-------------|-------------|
| 1 | [`apps/frontend-blog/src/app/[locale]/about/page.tsx`](apps/frontend-blog/src/app/[locale]/about/page.tsx:39) | Edit | Add 4 new tech items to frontend category |
| 2 | [`apps/frontend-blog/src/messages/zh.json`](apps/frontend-blog/src/messages/zh.json) | Edit | Add Chinese translations for 6 new keys |
| 3 | [`apps/frontend-blog/src/messages/en.json`](apps/frontend-blog/src/messages/en.json) | Edit | Add English translations for 6 new keys |
| 4 | [`apps/frontend-blog/src/messages/ko.json`](apps/frontend-blog/src/messages/ko.json) | Edit | Add Korean translations (or English fallback) |
| 5 | [`apps/frontend-blog/src/messages/ja.json`](apps/frontend-blog/src/messages/ja.json) | Edit | Add Japanese translations (or English fallback) |
| 6 | [`apps/frontend-blog/src/messages/fr.json`](apps/frontend-blog/src/messages/fr.json) | Edit | Add French translations (or English fallback) |
| 7 | [`apps/frontend-blog/src/messages/de.json`](apps/frontend-blog/src/messages/de.json) | Edit | Add German translations (or English fallback) |
| 8 | [`docs/blog/articles/projects/joymini-blog-platform.md`](docs/blog/articles/projects/joymini-blog-platform.md) | Edit | Major update with new PWA, Local-First, View Transitions, Adaptive Quality content |

---

## Terminology Reference (for consistent descriptions)

| English Term | Chinese Translation |
|-------------|-------------------|
| TanStack Query | React 数据获取与缓存 |
| Dexie.js | IndexedDB 本地数据库封装 |
| PWA offline support | PWA 离线支持 |
| Service Worker offline caching | Service Worker 离线缓存策略 |
| View Transitions API | 页面过渡动画 API |
| Local-First Offline | 本地优先离线架构 |
| Network-Aware Adaptive Quality | 网络感知自适应质量 |
| Hover Pre-fetch | 悬停预获取 |
| Cross-Component Video Coordination | 跨组件视频协调 |
