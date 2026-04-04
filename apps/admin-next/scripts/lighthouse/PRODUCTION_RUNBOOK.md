# Lighthouse 线上验收 — 操作说明书

> 适合人群：第一次跑，或者上次跑完忘了怎么做。  
> 目标：在本地 Mac 上，用真实生产地址 `admin.joyminis.com` 跑 Lighthouse，拿到 5 个页面的性能数据。

---

## 第零步：弄清楚这套东西在做什么（花 2 分钟读一遍）

```
你的 Mac（Chrome 无头浏览器）
        │
        │  Lighthouse 驱动 Chrome 打开每一个页面
        │  模拟用户访问，记录加载时间
        ▼
Cloudflare CDN → VPS（Next.js 服务器）
                      │
                      └──→ VPS（NestJS API，api.joyminis.com）
```

**为什么要在本地跑，不是在服务器上跑？**  
Lighthouse 需要 Chrome 浏览器。服务器是 Linux 命令行，没有 Chrome，也没有显示器。  
本地 Mac 有 Chrome，直接访问生产域名，测到的就是真实用户体验。

**为什么要先登录？**  
Analytics / Finance 这些页面需要登录才能访问。不登录的话，Lighthouse 只能测到登录页，其他页面会 redirect，数据没意义。

---

## 第一步：进入正确目录

```bash
cd /Volumes/MySSD/work/dev/lucky_nest_monorepo
```

> 必须在仓库根目录运行，否则 `yarn perf:lighthouse` 命令找不到。

---

## 第二步：拿登录 Token

管理后台的登录 API 在 `api.joyminis.com`，用 curl 拿一下 Token：

```bash
TOKEN=$(curl -s -X POST https://api.joyminis.com/api/v1/auth/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"这里填你的账号","password":"这里填你的密码"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['tokens']['accessToken'])")
```

验证一下 Token 有没有拿到（显示前 20 个字符）：

```bash
echo "Token 前缀: ${TOKEN:0:20}..."
```

**预期输出**（看到一串字母数字就对了）：

```
Token 前缀: eyJhbGciOiJIUzI1Ni...
```

**如果输出是空的**，说明账号密码错了，或者 API 挂了。先用浏览器开 `https://api.joyminis.com/api/v1/auth/admin/login` 看一眼（会返回 405，说明服务在线），再检查账号密码。

---

## 第三步：跑 Lighthouse

把刚才的 Token 作为 Cookie 传给脚本，正式开跑：

```bash
LIGHTHOUSE_COOKIE="auth_token=$TOKEN" \
LIGHTHOUSE_RUNS_PER_PAGE=3 \
yarn perf:lighthouse
```

**参数说明**：

- `LIGHTHOUSE_COOKIE` — 登录凭证，刚才拿的 Token 组装成 Cookie 格式
- `LIGHTHOUSE_RUNS_PER_PAGE=3` — 每个页面跑 3 次，取中位数，结果更准
- `yarn perf:lighthouse` — 执行脚本

**预期输出**（命令跑起来后你会看到这些）：

```
[lighthouse] Starting audit  baseUrl=https://admin.joyminis.com  runs=3
[lighthouse] Auth mode: env LIGHTHOUSE_COOKIE
[lighthouse] Auditing /login  run 1/3 ...
[lighthouse] Auditing /login  run 2/3 ...
[lighthouse] Auditing /login  run 3/3 ...
[lighthouse] /login  median LCP=620ms FCP=310ms TBT=0ms CLS=0.000  rating=warn
[lighthouse] Auditing / (Dashboard)  run 1/3 ...
...（每个页面都会这样打印）...
[lighthouse] Summary written → reports/lighthouse/2026-03-22T.../summary.json
[lighthouse] All pages done. Pass ✅  /  Warn ⚠️  /  Fail ❌
```

**大概要跑多久**：每个页面跑 3 次，每次约 30～60 秒，5 个页面总共约 10～20 分钟。

---

## 第四步：如果电脑卡住了，怎么停

| 操作                  | 效果                                                            |
| --------------------- | --------------------------------------------------------------- |
| 按一次 `Ctrl + C`     | **优雅停止**：当前这次 run 跑完再停，已完成的页面结果会写入文件 |
| 连续按两次 `Ctrl + C` | **强制退出**：立刻结束，已有结果可能不完整                      |

如果觉得跑太慢，可以加超时限制：

```bash
LIGHTHOUSE_COOKIE="auth_token=$TOKEN" \
LIGHTHOUSE_RUNS_PER_PAGE=1 \
LIGHTHOUSE_MAX_SECONDS_PER_RUN=90 \
yarn perf:lighthouse
```

> `RUNS_PER_PAGE=1` 每页只跑一次，速度快 3 倍；`MAX_SECONDS_PER_RUN=90` 单次超过 90 秒自动跳过。

---

## 第五步：看结果

报告文件保存在：

```
apps/admin-next/reports/lighthouse/
  └── 2026-03-22T10-30-00-000Z/    ← 以跑的时间命名
        ├── summary.json            ← 5 个页面汇总数据（机器可读）
        ├── summary.md              ← 表格版（可以直接贴文档）
        ├── login/
        │     ├── run-1.json
        │     ├── run-1.html        ← 用浏览器打开，有详细瀑布图
        │     ├── run-2.json
        │     └── run-2.html
        ├── dashboard/
        └── ...
```

**怎么看 summary.md**：

```bash
cat apps/admin-next/reports/lighthouse/$(ls apps/admin-next/reports/lighthouse | tail -1)/summary.md
```

**看某个页面的详细报告**（用浏览器打开 html）：

```bash
open apps/admin-next/reports/lighthouse/$(ls apps/admin-next/reports/lighthouse | tail -1)/analytics/run-1.html
```

---

## 指标怎么判断好不好

| 指标                    | 绿色（好） | 黄色（待优化）  | 红色（需立即处理） |
| ----------------------- | ---------- | --------------- | ------------------ |
| **LCP**（最大内容绘制） | < 500ms    | 500ms ～ 1500ms | > 1500ms           |
| **FCP**（首次内容绘制） | < 200ms    | 200ms ～ 1000ms | > 1000ms           |
| **TBT**（总阻塞时间）   | < 200ms    | 200ms ～ 600ms  | > 600ms            |
| **CLS**（布局偏移）     | < 0.1      | 0.1 ～ 0.25     | > 0.25             |

**指标高了说明什么问题**：

- `LCP` 高 → 首屏最重要的内容出现太晚（图片太大 / API 响应慢 / 依赖 JS 才能渲染）
- `FCP` 高 → 页面白屏太久（服务器返回 HTML 慢 / 关键 CSS 被阻塞）
- `TBT` 高 → 页面看起来在转圈但点不动（大 JS 包在主线程跑计算）
- `CLS` 高 → 页面内容突然跳动（图片没设高度 / 异步内容插入没有占位）

---

## 常见问题

### Q: Token 拿到了但 Lighthouse 报 401 / 403

Token 可能过期了（JWT 有效期通常是几小时）。重新跑第二步拿新 Token。

### Q: 报错 `Login failed (405)`

说明 `api.joyminis.com` 没有这个路径，或者你把 URL 写错了。  
检查第二步的 curl 命令，URL 应该是 `https://api.joyminis.com/api/v1/auth/admin/login`（注意有 `/api/v1`）。

### Q: Chrome 进程卡死，脚本不动了

先按一次 `Ctrl + C`，等 5 秒。如果还没反应，再按一次强制退出。  
下次跑前加 `LIGHTHOUSE_MAX_SECONDS_PER_RUN=90` 避免卡死。

### Q: 想只测一个页面，不想等全部跑完

修改 `apps/admin-next/scripts/lighthouse/config.mjs` 里的 `PAGES` 数组，  
只保留你想测的那一条，跑完后再改回来。

---

## 一行快跑（记住这个就够了）

```bash
cd /Volumes/MySSD/work/dev/lucky_nest_monorepo

TOKEN=$(curl -s -X POST https://api.joyminis.com/api/v1/auth/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"你的密码"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['tokens']['accessToken'])")

LIGHTHOUSE_COOKIE="auth_token=$TOKEN" LIGHTHOUSE_RUNS_PER_PAGE=3 yarn perf:lighthouse
```

三行，搞定。
