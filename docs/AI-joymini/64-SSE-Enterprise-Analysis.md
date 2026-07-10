# SSE 流式接口 — 企业级架构分析

> 本文从 7 个维度分析 SSE 流式接口的企业级实现方案
> 参考: [`14-AIChatAPI与ControllerSSE.md`](14-AIChatAPI与ControllerSSE.md)

---

## 一、架构总览

```
┌──────────┐    ┌──────────┐    ┌──────────────┐    ┌──────────┐
│  Frontend │───→│  Nginx   │───→│  NestJS API  │───→│ LangGraph│
│ (React)   │←───│ (Proxy)  │←───│ (SSE Stream) │←───│ (Agent)  │
└──────────┘    └──────────┘    └──────────────┘    └──────────┘
     │                                               │
     │  EventSource / fetchEventSource               │  streamEvents()
     │  data: {"type":"token","content":"亲"}        │  on_chat_model_stream
     │  data: {"type":"done",{}}                    │  on_tool_start/end
```

---

## 二、7 个分析维度

### 1. 体验 UX

#### 最佳体验

| 阶段 | 前端展示 | 用户感受 |
|------|---------|---------|
| 连接中 | 输入框 disable + "连接中..." | 知道系统在处理 |
| Agent 思考 | "正在查余额..." 动画 | 看到 AI 在做什么 |
| 逐 token 输出 | 打字机效果逐字显示 | 零等待感 |
| 工具调用 | "查到了，正在整理..." | 理解为什么需要等 |
| 完成 | 完整回复 + 输入框启用 | 可以继续提问 |

#### SSE 事件 → 前端映射

```typescript
// 前端事件处理器
onopen       → 显示"连接成功"，隐藏 loading
onmessage    → 解析 JSON，按 type 处理
  token      → 追加到当前回复气泡（打字机效果）
  step       → 显示/更新"思考步骤"指示器
  done       → 关闭打字机效果，启用输入框
  error      → 显示错误提示 + 重试按钮
onerror      → 连接断开，自动重连（fetchEventSource 内置）
```

#### 体验陷阱

| 陷阱 | 后果 | 解决方案 |
|------|------|---------|
| 无 loading 状态 | 用户以为没反应，重复发送 | 输入框 disable + 骨架屏 |
| 中间步骤太长 | 用户等得不耐烦 | tool 执行超过 3s 发一个"still working"事件 |
| 错误没提示 | 用户不知道出问题了 | 统一 error 事件 + 重试按钮 |
| 连接断了没重连 | 回复到一半停了 | fetchEventSource 自动重连 + 指数退避 |

---

### 2. 性能 Performance

#### 延迟分解

```
用户发送消息
  │
  ├─ 网络传输: 10-50ms (取决于用户地理位置)
  ├─ Nginx 代理: 1-5ms
  ├─ 参数校验: <1ms
  ├─ Auth 验证: 5-20ms (JWT 解密)
  │
  ├─ Intent 分类 (pgvector): 50ms
  ├─ Agent 执行:
  │   ├─ LLM 首字延迟 (TTFB): 200-1000ms
  │   ├─ Tool 调用: 100-500ms
  │   └─ LLM 生成: 1-5s (逐 token)
  ├─ 合成回复: 200-500ms
  │
  └─ 网络传输返回: 10-50ms

总耗时: 1.5s - 7s
```

#### 关键指标

| 指标 | 含义 | 目标 |
|------|------|------|
| TTFB (首字节) | 用户发送到收到第一个 token | < 500ms |
| TPOT (token 间延迟) | 相邻 token 的间隔 | < 50ms |
| 总响应时间 | 完整回复的时间 | < 5s |
| 连接数 | 同时活跃的 SSE 连接 | 参考压力测试 |

#### 优化手段

| 手段 | 效果 | 复杂度 |
|------|------|--------|
| 流式输出（不用等完整回复） | TTFB 从 2s → 200ms | ⭐⭐ 大改动 |
| Agent 执行时也定期发 keepalive | 防止连接超时 | ⭐ 小改动 |
| 工具调用结果缓存 | 减少重复 DB 查询 | ⭐⭐ 中等 |
| LLM 输出缓存（相同问题） | 0ms 命中 | ⭐⭐⭐ 需要缓存层 |
| 连接池复用 | 减少 TCP 握手 | ⭐ Nginx 配置 |

---

### 3. 速度 Speed

#### 首字延迟优化

首字延迟（用户看到第一个字的时间）是最关键的用户体验指标。

```
优化前: invoke() → 等全部完成 → 一次性返回  TTFB=2-7s ❌
优化后: streamEvents() → 逐 token 推送     TTFB=200-500ms ✅
```

实际优化效果：

```
用户说"查余额"
     │
优化前: invoke 等 Agent 跑完 → 2s 后一次性返回整段话
优化后: 500ms 后开始逐字显示 "您… 的… 钱… 包… 余… 额…"
```

**第一次交互就要流式输出**，不能等 intent 分类完再开始。也就是说 SSE 连接建立后立即发一个 `{"type":"step","content":"正在分析您的问题..."}` 让用户知道系统已经收到了。

#### Agent 中间步骤速度

| 步骤 | 耗时 | 用户体验 |
|------|------|---------|
| Intent 分类 | 50ms | 太快不需要展示 |
| 工具调用 | 100-500ms | 展示"正在查余额..." |
| LLM 生成 | 1-5s | 打字机效果 |
| 工具调用 2 | 100-500ms | 展示"正在获取优惠信息..." |
| LLM 生成 2 | 1-3s | 继续打字机 |

关键规则：**工具调用时不要卡住 SSE**。工具执行期间发 keepalive 或进度事件。

---

### 4. 压力 Stress

#### 并发场景

| 场景 | 并发连接数 | CPU 负载 | 内存 |
|------|-----------|---------|------|
| 正常日活 | 50-100 | 10-20% | 200-500MB |
| 促销活动 | 500-1000 | 50-70% | 2-5GB |
| DDoS 攻击 | 5000+ | 100% | OOM |

#### 限流策略

```typescript
// 1. 用户级限流 — 每人最多 1 个活跃 SSE
const activeConnections = new Map<string, Response>();
if (activeConnections.has(userId)) {
  // 关闭旧连接，允许新连接
  activeConnections.get(userId)?.end();
}
activeConnections.set(userId, res);
res.on('close', () => activeConnections.delete(userId));

// 2. IP 级限流 — 每分钟 20 次
// 用 NestJS 的 @Throttle() 装饰器
@Throttle({ default: { limit: 20, ttl: 60000 } })

// 3. 全局并发控制 — 最多 200 个 SSE 同时运行
// 用 Semaphore 信号量
const semaphore = new Semaphore(200);
await semaphore.acquire();
try { /* SSE logic */ } finally { semaphore.release(); }
```

#### 资源释放

| 场景 | 处理 |
|------|------|
| 用户关闭页面 | `res.on('close')` 清理 |
| 网络断开 | fetchEventSource 自动重连 |
| 服务端超时 | 30 分钟后自动 end |
| 进程重启 | Nginx 返回 502，前端重试 |

---

### 5. 兼容性 Compatibility

#### 浏览器兼容

| 浏览器 | SSE 支持 | 问题 |
|--------|---------|------|
| Chrome 6+ | ✅ | 全部正常 |
| Firefox 6+ | ✅ | 全部正常 |
| Safari 5+ | ✅ | 全部正常 |
| Edge 79+ | ✅ | 全部正常 |
| IE 11 | ❌ | **不支持 EventSource** |
| 微信浏览器 | ⚠️ | 部分版本不支持，需 polyfill |
| 移动端 WebView | ⚠️ | 取决于系统 WebView 版本 |

#### IE 11 / 微信兼容方案

```
方案 A: polyfill → 引入 eventsource-polyfill.js (~5KB)
方案 B: fetch + ReadableStream → 手动解析 SSE 格式
方案 C: WebSocket fallback → 检测不支持时切到 WS
```

#### Nginx 配置

```nginx
# SSE 关键配置
location /api/v1/ai/customer/chat-stream {
    proxy_pass http://backend;
    proxy_http_version 1.1;          # 必须 HTTP/1.1
    proxy_buffering off;             # 禁用缓冲
    proxy_cache off;                 # 禁用缓存
    proxy_set_header Connection '';  # 保持长连接
    chunked_transfer_encoding on;    # 分块传输
    proxy_read_timeout 300s;         # 5 分钟超时
    proxy_send_timeout 300s;
    
    # 如果不加这些，Nginx 会缓冲 SSE 数据，导致前端延迟收到
}
```

#### K8s / 负载均衡器

| 组件 | 注意事项 |
|------|---------|
| AWS ALB | 空闲超时默认 60s，需调到 300s+ |
| K8s Ingress | `nginx.ingress.kubernetes.io/proxy-buffering: "false"` |
| Cloudflare | 需要关闭 Rocket Loader + Auto Minify |
| CDN | SSE 不能走 CDN 缓存 |

---

### 6. 方案对比

#### 三个方案

| 维度 | 方案 A: 当前 (invoke) | 方案 B: 基础 SSE | 方案 C: 企业级 SSE |
|------|---------------------|-----------------|-------------------|
| 延迟 | TTFB=2-7s ❌ | TTFB=200ms ✅ | TTFB=200ms ✅ |
| 中间步骤 | 不可见 ❌ | 部分可见 🟡 | 完整可见 ✅ |
| Nginx 配置 | 不需要 ✅ | 需 proxy_buffering off 🟡 | 完整配置 ✅ |
| 限流 | 不需要 ✅ | 无 ❌ | 三层限流 ✅ |
| 断线重连 | 不需要 ✅ | fetchEventSource 🟡 | 指数退避重连 ✅ |
| 兼容性 | 全兼容 ✅ | 不支持 IE ❌ | polyfill + fallback ✅ |
| 复杂度 | 0 ⭐ | ⭐⭐ | ⭐⭐⭐⭐ |

#### 方案 C 的额外能力

```
企业级 SSE 比基础 SSE 多这些:
  1. 限流 (用户级 + IP 级 + 全局)
  2. 断线重连 (指数退避 + 上下文恢复)
  3. 中间步骤完整展示 (tool_call + result + thinking)
  4. Nginx/K8s/ALB 全场景配置
  5. IE 兼容 + 移动端 fallback
  6. 健康检查 + 指标上报
  7. 慢查询预警 (tool call > 5s 报警)
```

---

### 7. 场景分析

#### 最佳场景

```
用户: "查余额"
系统: 
  1. {"type":"step","content":"正在查您的余额..."}  ← 200ms
  2. {"type":"token","content":"您"}               ← 500ms 首字
  3. {"type":"token","content":"的"}
  4. {"type":"token","content":"余额"}
  5. {"type":"token","content":"是"}
  6. {"type":"token","content":"1,500"}
  7. {"type":"token","content":"比索"}
  8. {"type":"done"}                               ← 总耗时 2s
```

#### 最差场景

```
用户: "这个包多少钱，我有什么优惠券，钱包够不够"
系统:
  1. 意图分类 → 3 个标签 (product, coupon, wallet)
  2. Product Agent: 查商品 (500ms)
  3. Coupon Agent: 查优惠券 (300ms)  
  4. Wallet Agent: 查余额 (200ms)
  5. LLM 合成回复 (2s)
  6. 中间步骤展示 + 最终合成
  总耗时: 5-7s
```

#### 异常场景

| 场景 | 表现 | 处理 |
|------|------|------|
| LLM 超时 | 无 token 输出 > 30s | 发 error 事件 + 重试按钮 |
| Tool 调用失败 | 查余额报错 | 发 error 事件，继续其他 Agent |
| 用户中途取消 | 关闭页面 | `res.on('close')` 清理 |
| 并发超限 | 超过 200 连接 | 返回 429 Too Many Requests |
| Nginx 断开 | proxy_read_timeout | fetchEventSource 自动重连 |
| 后端重启 | SSE 连接中断 | Nginx 502 → fetchEventSource 重试 |

---

## 三、实现建议

### 优先做（最小可用）

1. Controller + Service 的 SSE 基础实现（已有 doc 14 代码）
2. Nginx proxy_buffering off 配置
3. 用户级限流（每人 1 个连接）
4. 前端 fetchEventSource 集成

### 推荐做（投产必备）

5. 首字延迟优化（streamEvents）
6. 中间步骤事件（tool_start/tool_end）
7. 断线重连（指数退避）
8. 全局并发控制（200 上限）

### 有空再做（锦上添花）

9. IE polyfill
10. 慢查询预警
11. 指标上报（Prometheus）
12. 工具调用缓存
