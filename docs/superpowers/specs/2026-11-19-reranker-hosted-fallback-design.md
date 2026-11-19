# Reranker 短期方案：Jina 托管 + RRF 降级

> 日期：2026-11-19
> 状态：待确认
> 范围：短期恢复生产 rerank，不引入自建模型、不增加 VPS 内存占用

## 背景

线上 VPS（7.8G / 4 vCPU）当前没有可用的 reranker：

- Infinity 只加载 `BAAI/bge-m3`，`capabilities: ["embed"]`，`/v1/rerank` 返回 404
- 后端 `RERANK_BASE_URL` 未配置
- `JINA_API_KEY` 未配置，`JinaProvider` 启动即禁用
- 结果是 RAG 走 `fallbackSort`，按向量/BM25/关键词的混合原始分排序，量纲不可比

本地评测还暴露了第二个问题：`JinaProvider` 把日额度硬编码为 `DAILY_LIMIT = 1_000_000`，达到后 `isAvailable()` 直接 false。但 Jina 控制台实际记录显示：

- 最近 7 天 rerank：698 次请求、2,945,330 tokens
- 今天单个小时：419 次请求、2,133,684 tokens，Jina 仍正常返回 200
- 平均每请求约 4.2K tokens，不是之前估算的 10K

也就是说：**不是 Jina 额度用完了，是我们自己的代码在 1M 处提前把自己关掉了**。一轮 129 题 × 2 次请求约 1.1M tokens，刚好越过这个硬编码阈值，导致评测中途降级、跨轮不可比。

## 目标

1. 用 **Jina 托管 rerank** 恢复生产语义重排，零内存占用
2. Jina 不可用（未配置、429、日额度耗尽）时，降级到 **RRF 融合排序**，而不是混合原始分
3. 让“这次用了哪个 reranker / 是否降级”在日志和指标里可见
4. 评测口径与生产解耦：召回层用 `rerank=false`，rerank 对比在额度内跑

## 非目标

- 不在本次自建 bge-reranker（内存与 CPU 风险留到后续方案）
- 不改 embedding、不换模型、不改切片
- 不改线上默认 topK 与候选数量
- 不自动改 VPS 环境变量（需要单独授权）

## 方案

### 1. 生产配置 Jina

- 在 VPS 后端环境配置 `JINA_API_KEY`（支持逗号分隔多 key）
- 重启后端，确认启动日志不再出现 `JinaProvider disabled`
- 用一次真实 RAG 查询确认日志出现 `Jina` rerank

### 2. RRF 降级

当前 `fallbackSort` 按混合原始分排序。改为：

- 每层（vector / meili / chunk / doc）先按各自排名计算 RRF 分：`Σ 1/(60 + rank)`
- 同一 chunk 出现在多层时累加
- reranker 可用：仍用 reranker 分数排序
- reranker 不可用：按 RRF 分排序，再做 topK 截断

RRF 只看排名，不比较不同层的原始分数，避免“关键词固定 0.5 压过向量 0.45”这类问题。

### 3. Provider 归属与降级可见

- `AiService.rerank()` 返回实际 provider（如 `jina` / `null`），或在 `RagRetrievalService` 记录最近一次 provider
- `emitStage('retrieval')` 增加：
  - `rerankProvider`: `jina` / `none`
  - `rerankFallback`: `rrf` / null
- Prometheus counter：`rag_rerank_total{provider, outcome}`，outcome = `success` / `unavailable` / `error`
- 告警建议：`rerankFallback=rrf` 比例连续 15 分钟 > 20%，或 Jina 429 次数突增

### 4. 额度保护

- 把 `DAILY_LIMIT` 改为可配置：`JINA_DAILY_TOKEN_LIMIT`，默认 **3,000,000**（按当前账户实际可承载量，留出余量）
- 达到 80% 时打 warn，便于提前切换/扩容；达到上限才 `isAvailable()=false`
- 收到真实 429 时仍按现有逻辑轮询 key、60 秒冷却；不要把“本地计数到顶”和“服务端 429”混为一谈
- 启动和每次达到阈值时输出现有日用量，便于和 Jina 控制台对账
- 注意：provider 记录的是响应里的 `usage.total_tokens`，控制台统计口径可能略高；两者不一致时以控制台为准，日志保留本地值

### 5. 评测口径

- 召回层验收固定 `--rerank false`
- rerank 对比使用 `--limit` 控制在额度内（建议 ≤60 题/次），或使用付费 key
- 报告记录本次实际 rerank provider，避免把 Jina、兜底、RRF 混在一起比较

## 风险与取舍

- **Jina 日额度是账号级、不是无限** → 按控制台 7 天 2.9M 的使用量，日承载约 2–3M；把默认上限设 3M 并监控，超限自动 RRF，不阻塞回答
- **RRF 质量低于 cross-encoder** → 作为降级可接受；后续再评估自建小模型
- **Jina 是外部依赖** → 网络/额度失败时必须有 RRF 兜底；不能把 rerank 失败当回答失败
- **多 key 轮询** → 每个 key 独立计数；需要确认账号额度是否按 key 叠加
- **本地计数与控制台口径差异** → 日志同时保留本地值与 provider 返回值，定期对账

## 后续（不在本次）

- 自建小 reranker sidecar（bge-reranker-base / int8，约 0.5–0.7G）
- 或 RRF 升级为主排序，cross-encoder 只做可选增强
- 中文召回变更 `rag-chinese-recall` 完成后，用其分层指标评估 RRF 与 rerank 的差异

## 需要你确认

1. 是否同意“Jina 托管 + RRF 降级”作为短期方案
2. 是否授权在 VPS 配置 `JINA_API_KEY` 并重启后端
3. RRF 的 `k=60` 是否接受（标准默认值）
