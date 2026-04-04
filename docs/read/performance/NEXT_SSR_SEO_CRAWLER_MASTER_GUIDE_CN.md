# Next.js SSR SEO 与爬虫抓取完全掌握指南（App Router）

> 目标：看完后，你可以独立设计、实现、验证一个可被搜索引擎稳定抓取和收录的 Next.js SSR 项目。
>
> 适用：Next.js 14/15 + App Router + SSR/SSG/ISR 混合项目。

---

## 0. 先建立正确心智模型

SEO 不是一个点，而是一个链路：

1. **发现（Discovery）**：爬虫能不能找到 URL（站内链接、sitemap、外链）
2. **抓取（Crawling）**：爬虫能不能成功请求页面（状态码、robots、超时）
3. **渲染（Rendering）**：爬虫能不能拿到可理解内容（SSR HTML、结构化数据）
4. **索引（Indexing）**：页面是否被收录（canonical、质量、重复内容）
5. **排序（Ranking）**：是否有足够相关性和体验（内容质量、CWV、内链）

**结论**：只做 `meta title` 远远不够；你要管理的是整条链路。

---

## 1. Next.js 渲染模式与 SEO 的关系

| 模式 | 首屏产物                        | 对爬虫友好度           | 典型用途           | SEO 风险                       |
| ---- | ------------------------------- | ---------------------- | ------------------ | ------------------------------ |
| CSR  | 空壳 + JS                       | 中等（依赖渲染器能力） | 强交互后台         | 内容渲染延迟、抓取不稳定       |
| SSR  | 每次请求出 HTML                 | 高                     | 商品详情、新闻详情 | TTFB 过高会拖慢抓取预算        |
| SSG  | 构建时静态 HTML                 | 高                     | 落地页、政策页     | 内容更新不及时                 |
| ISR  | 静态 + 增量更新                 | 高                     | 列表页、频道页     | 失效策略不当会脏数据           |
| RSC  | Server Component payload + HTML | 高（首屏内容仍可见）   | App Router 主流    | 客户端交互与索引信号需分离设计 |

**实践建议**：

- SEO 核心页优先 SSR/SSG/ISR，不要纯 CSR。
- 高更新频率页用 ISR + 明确 `revalidate` 或 tag 失效。
- 把“首屏可读内容”放在 Server 侧输出，不依赖客户端二次请求。

---

## 2. 必备基础：状态码、URL、可访问性

### 2.1 状态码规则

- 内容存在：`200`
- 永久迁移：`301`
- 临时迁移：`302/307`
- 不存在：`404`
- 已删除：`410`

**不要**把不存在页面都重定向到首页，这会导致“软 404”。

### 2.2 URL 规范

- 一个内容只保留一个主 URL（canonical）
- 去重参数（如追踪参数）
- 统一尾斜杠、大小写、协议（https）

### 2.3 可访问性信号

- 标题层级（`h1/h2`）清晰
- 图片有 `alt`
- 页面有可读文本，不只是图和 JS 组件

---

## 3. App Router 元信息：metadata 是主战场

### 3.1 全局 metadata（`layout.tsx`）

```ts
import type { Metadata } from "next";

export const metadata: Metadata = {
  metadataBase: new URL("https://example.com"),
  title: {
    default: "Site Name",
    template: "%s | Site Name",
  },
  description: "Site description",
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: "website",
    siteName: "Site Name",
  },
  twitter: {
    card: "summary_large_image",
  },
};
```

### 3.2 页面级 metadata（`page.tsx`）

```ts
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Product Detail",
  description: "Buy high quality product",
};
```

### 3.3 动态 metadata（`generateMetadata`）

适合详情页：根据 slug/id 拉取数据生成标题、描述、OG 图。

```ts
import type { Metadata } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await fetchProduct(slug);

  if (!product) {
    return { title: "Not Found" };
  }

  return {
    title: product.name,
    description: product.seoDescription,
    alternates: {
      canonical: `/products/${slug}`,
    },
    openGraph: {
      title: product.name,
      description: product.seoDescription,
      images: [product.coverUrl],
      type: "product",
    },
  };
}
```

---

## 4. robots.txt 与 sitemap.xml：抓取入口层

### 4.1 `robots.ts`

```ts
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/api/private"],
      },
    ],
    sitemap: "https://example.com/sitemap.xml",
  };
}
```

### 4.2 `sitemap.ts`

```ts
import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://example.com/",
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: "https://example.com/products",
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 0.9,
    },
  ];
}
```

### 4.3 大站扩展

- URL > 50,000：拆分 sitemap index
- 图片/视频密集站点：补 image/video sitemap
- 多语言站点：配合 hreflang + alternates

---

## 5. canonical 与重复内容治理

重复内容是索引大敌：分页、筛选、追踪参数、排序参数都会制造重复页。

### 5.1 canonical 设置

```ts
export const metadata = {
  alternates: {
    canonical: "/products/iphone-15",
  },
};
```

### 5.2 参数策略

- 保留有业务意义参数（如 `page=2`）
- 清理追踪参数（`utm_*`, `fbclid`）
- 对筛选页建立主次：主筛选索引，长尾组合可 noindex

---

## 6. 结构化数据（JSON-LD）

结构化数据帮助搜索引擎“理解”内容实体，提高富结果机会。

常见类型：

- `Organization`
- `BreadcrumbList`
- `Product`
- `Article`
- `FAQPage`

示例（产品页）：

```tsx
const productSchema = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: product.name,
  image: product.images,
  description: product.seoDescription,
  brand: { "@type": "Brand", name: product.brand },
  offers: {
    "@type": "Offer",
    priceCurrency: "USD",
    price: product.price,
    availability: "https://schema.org/InStock",
  },
};

return (
  <script
    type="application/ld+json"
    dangerouslySetInnerHTML={{ __html: JSON.stringify(productSchema) }}
  />
);
```

---

## 7. 内容层优化：搜索引擎真正评分的核心

### 7.1 页面内容结构

- 唯一 `h1`
- 首屏可见核心信息（不要全部折叠）
- 有实体信息（价格、规格、发布时间、作者等）

### 7.2 内链策略

- 列表页链接到详情页
- 详情页链接相关内容（相关推荐）
- 面包屑增强层级理解

### 7.3 E-E-A-T 导向

- 作者/品牌信息
- 隐私政策、服务条款、联系方式
- 内容更新日期、来源说明

---

## 8. 性能与 SEO：Core Web Vitals

Google 排名会参考用户体验信号，重点关注：

- **LCP**（首屏最大内容渲染）
- **INP**（交互响应）
- **CLS**（布局稳定）

### 8.1 Next.js 常用优化点

- `next/image` 固定尺寸避免 CLS
- 字体本地化与预加载
- RSC 减少客户端 bundle
- 列表页按需加载，不阻塞首屏
- 关键 API 降低 TTFB

### 8.2 目标建议（经验值）

- LCP < 2.5s
- INP < 200ms
- CLS < 0.1

---

## 9. SSR 项目中的缓存与索引一致性

SEO 页最怕“用户看到 A、爬虫抓到 B”。

### 9.1 常见缓存层

1. 浏览器缓存
2. CDN 缓存
3. Next Data Cache / Full Route Cache
4. 服务端数据源缓存

### 9.2 实践原则

- SEO 页面改动后有明确失效动作（`revalidateTag` / `revalidatePath`）
- 重要详情页保证内容与 metadata 同步更新
- 缓存 TTL 与业务更新频率匹配

---

## 10. 多语言 SEO（如果有 i18n）

必须做 `hreflang`，避免语言版本互相竞争。

```ts
export const metadata = {
  alternates: {
    canonical: "https://example.com/en/product/123",
    languages: {
      en: "https://example.com/en/product/123",
      zh: "https://example.com/zh/product/123",
    },
  },
};
```

---

## 11. 监控与验收闭环（上线后比上线前更重要）

### 11.1 工具清单

- Google Search Console（索引/覆盖率）
- Bing Webmaster Tools
- Lighthouse CI（性能回归）
- Sentry（运行时错误与慢事务）
- 日志平台（抓取 UA、状态码、慢请求）

### 11.2 每周看板（最小集合）

- 有效索引页数
- 抓取失败页数（4xx/5xx）
- 平均 LCP / INP / CLS
- sitemap 提交与抓取成功率
- Top 落地页自然流量趋势

---

## 12. Next SSR SEO 常见坑（高频）

1. `robots.txt` 放开了，但 `metadata.robots` 里仍然 `noindex`
2. 详情页 canonical 指向列表页，导致详情不收录
3. 动态页返回 200 + 空内容（应返回 404）
4. 全部内容在客户端请求，HTML 首屏只有骨架
5. sitemap 只写了首页，详情页从未被发现
6. 旧 URL 改版后未做 301 映射
7. 页面可访问但 TTFB 很高，抓取预算被浪费

---

## 13. Admin 后台与公开站点的策略分离（非常关键）

- **公开站点（需要 SEO）**：`index/follow` + allow crawl
- **管理后台（通常不需要 SEO）**：建议 noindex + 鉴权

你可以用域名或路由前缀分离策略：

- `www.example.com`：开放索引
- `admin.example.com`：默认不索引

> 如果你明确要求 Admin 也可被索引，要确保不暴露敏感路径和隐私数据。

---

## 14. 项目实战落地清单（可直接执行）

### 上线前

- [ ] 每个公开页面有唯一 title/description
- [ ] 关键详情页实现 `generateMetadata`
- [ ] `robots.ts` 与 `sitemap.ts` 已部署可访问
- [ ] canonical 设置完成，无明显重复内容
- [ ] 结构化数据通过 Rich Results Test
- [ ] 404/301 行为符合预期
- [ ] Lighthouse 关键页达标

### 上线后 7 天内

- [ ] Search Console 提交 sitemap
- [ ] 观察覆盖率、抓取错误、重复页面
- [ ] 修复 4xx/5xx 与软 404
- [ ] 检查首批收录页面的 snippet 是否合理

### 持续迭代

- [ ] 新页面发布自动纳入 sitemap
- [ ] 变更 URL 时必须做 redirect map
- [ ] 每次大改版做 SEO 回归测试

---

## 15. 心智模型提问（必须会）

1. 为什么“页面可访问”不等于“页面可收录”？
2. 为什么 SSR 页面仍可能不被索引？
3. 当内容更新后，为什么 metadata 可能还是旧的？
4. canonical 写错时，搜索引擎会如何选择主页面？
5. 站点越大，为什么越要重视抓取预算？
6. 为什么 SEO 问题常常是“缓存一致性问题”？

---

## 16. 最小可用模板（App Router）

目录建议：

```text
src/app/
  layout.tsx          # 全局 metadata
  robots.ts           # robots.txt
  sitemap.ts          # sitemap.xml
  (public)/
    page.tsx
    products/[slug]/page.tsx   # generateMetadata + JSON-LD
```

策略建议：

- 公开页：可索引
- 登录页：通常 `noindex`
- 后台页：noindex + 鉴权

---

## 17. 结论

真正成熟的 Next.js SSR SEO 不是“加几个 meta 标签”，而是：

- 有完整抓取链路设计
- 有可观测性与回归机制
- 有缓存一致性策略
- 有按页面类型分层治理的工程纪律

当你能把这四点做成团队标准，SEO 才会稳定增长，而不是靠运气。

---

## 附：推荐联读

- `read/performance/SEO_SUMMARY_CN.md`
- `read/performance/SEO_PERFORMANCE_CN.md`
- `read/performance/PERFORMANCE_LIGHTHOUSE_CN.md`
- `read/devops/LHCI_SENTRY_SETUP_CN.md`
