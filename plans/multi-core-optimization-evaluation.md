# 后端多核优化评估报告

## 1. 服务器 CPU 现状

| 项目 | 值 |
|------|-----|
| CPU 核心数 | **4 核**（不是 8 核） |
| CPU 型号 | AMD EPYC 9J45 |
| 架构 | 4 sockets × 1 core/socket × 1 thread/core |
| 总内存 | 7.8 GB |
| 容器内存限制 | Backend 2GB, PostgreSQL 2GB, Redis 512MB, Nginx 64MB |

## 2. 当前配置状态

| 组件 | 当前值 | 是否最优 |
|------|--------|---------|
| Node.js 进程 | 单进程（无 cluster 模式） | ✅ 适合当前架构 |
| UV_THREADPOOL_SIZE | 默认 4（未设置） | ✅ 匹配 4 核 |
| Nginx worker_processes | `auto` → 4 workers | ✅ 最优 |
| Nginx proxy_cache | 60s TTL, 2GB max | ✅ 已启用 |
| Nginx gzip | level 5 | ✅ 已启用 |
| PostgreSQL shared_buffers | 256MB | ⚠️ 可优化 |
| 应用层缓存 | PublicCacheInterceptor (NestJS) | ✅ 已启用 |
| Prisma 慢查询日志 | 200ms 阈值 | ✅ 已启用 |

## 3. 优化评估

### ❌ 不推荐：Cluster 模式

**原因：**
- 瓶颈是 DB I/O，不是 CPU。Node.js 单进程处理 API 请求时，大部分时间在等待 Prisma 查询返回
- 每个 worker 额外消耗 ~100-200MB RAM（2GB 限制下影响显著）
- Prisma 连接数会乘以 worker 数（每个 worker 独立连接池）
- WebSocket 需要 sticky session 或外部 pub/sub
- 复杂度增加（进程崩溃恢复、优雅重启）

### ❌ 不推荐：增加 UV_THREADPOOL_SIZE

**原因：**
- 默认 4 已匹配 4 核
- bcrypt/JWT 操作量不大，不是瓶颈
- 增加线程数反而会增加上下文切换开销

### ⚠️ 低优先级：PostgreSQL shared_buffers

**当前：** 256MB（7.8GB RAM 的 3.3%）
**建议：** 可增加到 512MB-1GB
**但：** PG 当前仅使用 ~48MB，不是瓶颈

### ✅ 推荐：数据库查询优化（高优先级）

**现状：**
- Prisma 已配置慢查询日志（200ms 阈值），但生产环境不输出查询日志（`if (!this.isDev) return;`）
- 慢查询仍会输出（`isSlow` 分支在生产和开发都会执行）

**建议：**
1. 分析现有慢查询日志，识别需要加索引的表
2. 对高频查询添加覆盖索引（covering index）
3. 优化 N+1 查询模式

### ✅ 推荐：应用层 Redis 缓存扩展（中优先级）

**现状：**
- `PublicCacheInterceptor` 已实现，基于 `@nestjs/cache-manager`
- 缓存 key 包含 locale/platform 维度隔离
- 支持 `__nocache` 调试绕过

**建议：**
1. 审计哪些 API 端点未使用缓存但适合缓存
2. 对低频变化的数据（系统配置、分类列表）增加更长的 TTL

### ✅ 推荐：Nginx proxy_cache TTL 调优（低优先级）

**现状：**
- 所有匹配 `~/api/v1/blog/` 的公开 API 缓存 60s
- 2GB 缓存空间

**建议：**
- 对几乎不变的数据（如分类列表）可延长到 300s
- 对文章详情页可延长到 120s

## 4. 总结

**核心结论：不需要启用 cluster 模式。** 对于 API 网关应用，单 Node.js 进程配合 Nginx 反向代理 + 缓存是最优架构。真正的性能瓶颈在数据库查询层面，而非 CPU。

**推荐执行顺序：**
1. 收集并分析 Prisma 慢查询日志 → 加索引
2. 审计 API 缓存覆盖率 → 扩展 Redis 缓存
3. 微调 Nginx proxy_cache TTL
4. （可选）增加 PostgreSQL shared_buffers 到 512MB
