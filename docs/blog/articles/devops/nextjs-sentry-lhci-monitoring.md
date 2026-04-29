---
title: 'Sentry + Lighthouse CI 全链路监控体系搭建实战'
slug: 'nextjs-sentry-lhci-monitoring'
tags: Sentry, Lighthouse, Monitoring, DevOps, Performance
---

# Sentry + Lighthouse CI 全链路监控体系搭建实战

## 1. 背景：从「手动跑分」到「自动门禁」

大多数前端团队的性能监控停留在「想起来跑一次 Lighthouse」的阶段。问题是：

- 发布后性能退化，可能要过几天才被发现
- 生产报错全靠用户反馈，无法主动感知
- 每次排查都需要「重现」，效率极低

本文介绍如何用两个免费工具解决上述问题：

| 工具 | 解决什么 | 数据来源 | 免费额度 |
|------|---------|---------|---------|
| **Lighthouse CI** | 防止每次发布后性能退化 | 合成测试（模拟浏览器） | GitHub Actions 2000min/月 |
| **Sentry** | 生产报错可见 + 定位到行 | 真实用户访问 | 10,000 事件/月 |

两者配合形成完整链路：

```
git push → LHCI 自动跑性能 → PR 评论提醒退化
                              ↓
                         Sentry 收集真实用户报错
                         （谁、什么页面、什么操作、stack trace）
```

---

## 2. Lighthouse CI：自动化性能门禁

### 2.1 LHCI vs 本地脚本

项目之前已有 `run.mjs` 脚本用于本地手动跑 Lighthouse。LHCI 与其不冲突，而是互补：

| run.mjs（本地） | LHCI（CI） |
|----------------|------------|
| 手动触发 | 自动触发（git push/PR） |
| 多次运行取中位数 | 多次运行取中位数 |
| 本地报告文件 | 上传到临时公共存储（趋势图） |
| — | 自动发 PR 评论（数字+状态） |
| — | 断言超阈值标红，阻止合并 |

### 2.2 执行流程

```
git push / PR 到 main
        ↓
GitHub Actions 启动
        ↓
Step 1: curl 生产 API 拿登录 Token
        ↓
Step 2: Token 设为环境变量 LHCI_COOKIE
        ↓
Step 3: lhci autorun (= collect + upload + assert)
  │
  ├─ collect: Chrome 打开 5 个页面，每页跑 1 次
  ├─ upload: 结果上传到 temporary-public-storage（免费，保存 7 天）
  └─ assert: LCP > 2500ms → warn / TBT > 600ms → error
        ↓
Step 4: GitHub Actions 上传原始 HTML 报告为 Artifacts（30 天）
        ↓
Step 5: PR 评论发布汇总表
```

### 2.3 关键配置

`lighthouserc.js` 核心配置：

```js
module.exports = {
  ci: {
    collect: {
      url: [
        'https://admin.joyminis.com/dashboard',
        'https://admin.joyminis.com/orders',
        'https://admin.joyminis.com/users',
        'https://admin.joyminis.com/finance/deposits',
        'https://admin.joyminis.com/finance/withdrawals',
      ],
      numberOfRuns: 3,  // 每页跑 3 次取中位数
      settings: {
        preset: 'desktop',
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['warn', { minScore: 0.8 }],
        'lcp': ['warn', { maxNumericValue: 2500 }],
        'total-blocking-time': ['error', { maxNumericValue: 600 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
```

### 2.4 temporary-public-storage

LHCI 的免费存储方案——结果上传到 Google 的 `storage.googleapis.com`，7 天自动删除。

**这意味着：**

- 免费，无需自建服务器
- 可看历史趋势（URL 贴在 PR 评论）
- ⚠️ 数据公开（只有指标数字，不含代码或用户数据，可接受）
- ⚠️ 7 天后删除（本地 Artifacts 保存 30 天更长久）

### 2.5 CI 中的认证处理

管理后台需要登录，LHCI 通过先登录获取 Cookie 再进行测试：

```yml
- name: Get auth cookie
  run: |
    TOKEN=$(curl -s -X POST https://admin.joyminis.com/api/auth/login \
      -H "Content-Type: application/json" \
      -d '{"account":"${{ secrets.LIGHTHOUSE_ADMIN_USERNAME }}","password":"${{ secrets.LIGHTHOUSE_ADMIN_PASSWORD }}"}' \
      | jq -r '.token')
    echo "LHCI_COOKIE=auth_token=$TOKEN" >> $GITHUB_ENV
```

---

## 3. Sentry：生产报错可见性

### 3.1 Next.js 三层配置

Next.js 有三个运行环境，Sentry 需要分别配置：

```
sentry.client.config.ts   ← 浏览器端：捕获前端 JS 报错
sentry.server.config.ts   ← Node.js 服务端：捕获 Server Component / API Route 报错
sentry.edge.config.ts     ← Edge Runtime：捕获 middleware 报错

src/instrumentation.ts    ← Next.js 生命周期钩子，启动时初始化 Sentry
next.config.ts            ← 用 withSentryConfig 包裹，开启 source map 上传
```

### 3.2 Source Map 上传

生产代码打包压缩后，报错 stack trace 难以阅读：

```
Error: Cannot read property 'id' of undefined
  at e.default.t.render (main.abc123.js:1:8734)   ← 看不懂
```

上传 source map 后，Sentry 还原成原始代码：

```
Error: Cannot read property 'id' of undefined
  at OrderManagementClient.tsx:142:5               ← 直接定位到行
  in handleApprove()
```

Source map 上传在 CI 构建时自动进行，需配置 `SENTRY_AUTH_TOKEN`。

### 3.3 性能采样策略

管理后台用户少（约 2~5 人），性能事务采样率设为 10%：

```ts
tracesSampleRate: 0.1   // 10% 采样
```

每天约 50 次页面访问 × 10% = 5 次性能事务。10,000 免费额度 ÷ 5 = 2000 天不会超额，同时保留足够数据定位偶发慢请求。

### 3.4 哪些请求应关闭 tracing

不是所有请求都值得上报。建议关闭的场景：

```ts
// ❌ 关闭：轮询、角标、低价值后台刷新
http.get("/v1/admin/applications/pending-count", undefined, {
  trace: false,
});

// ✅ 保留：关键业务操作
http.get("/v1/admin/settings/detail", undefined, {
  trace: {
    name: "admin.http.settings_load",
    attributes: { feature: "settings" },
  },
});
```

**建议关闭 tracing：** 角标计数、fallback polling、socket 失败兜底、页面隐藏后的后台刷新
**建议保留：** 首屏查询、创建/编辑/审核/支付/导出、客服回复、怀疑慢的请求

### 3.5 必备环境变量

```bash
# 最小必配
NEXT_PUBLIC_SENTRY_DSN=https://xxx@ooo.ingest.sentry.io/yyy
SENTRY_AUTH_TOKEN=sntrys_xxx
```

---

## 4. 上线验证

### LHCI 验证
1. 推代码到 `main`
2. 打开 GitHub → Actions → Lighthouse CI 工作流
3. 等待运行完成，看 PR 评论的 LCP/TBT 数字
4. 点 LHCI 生成的临时 URL，看趋势图

### Sentry 验证
1. 打开管理后台，登录
2. DevTools Network 标签，看是否有发往 `sentry.io` 的请求
3. 临时扔一个 `throw new Error('Sentry test')`，确认 Sentry 后台能收到
4. 删除测试代码

### 排障入口
Sentry 项目 → Issues → 筛选 `environment:production`：
- **Stack Trace**：是否还原到源码行
- **Breadcrumbs**：报错前用户操作
- **Tags**：release / browser / url
- 修复后标记 `Resolved`，观察是否 `Regressed`

---

## 5. 总结

| 工具 | 核心价值 | 成本 |
|------|---------|------|
| LHCI | 每次 push 自动跑性能，退化即标红 | GitHub Actions 分钟数 |
| Sentry | 生产报错主动感知，正确定位到行 | 10,000 事件/月免费 |

**关键要点：**

1. **LHCI = 自动化版 Lighthouse**：手动跑变成每次 push 自动跑
2. **temporary-public-storage**：免费临时存储，无需自建服务器
3. **Sentry 三层配置**：Next.js 三个运行环境分别初始化
4. **Source Map**：将压缩报错还原为原始文件+行号
5. **采样率**：10% 足够定位问题，且不超免费额度
6. **withSentryConfig**：在 `next build` 时自动上传 source map
