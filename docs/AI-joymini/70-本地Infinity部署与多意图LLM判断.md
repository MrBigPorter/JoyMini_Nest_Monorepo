# 本地 Infinity 部署 + MIN_SCORE 调整 + 多意图 LLM 判断

> 日期: 2026-07-15
> 关联: #43 bge-m3 集成, #63 Score Gap Check, #69 Jina AI Migration

---

## 改动一：本地 Infinity (bge-m3) 部署

### 背景
之前用 Jina AI 线上 API 做 embedding（`jina-embeddings-v5-text-small`），准确度不够，尤其在中英混合场景下不如 bge-m3。本次切回本地 Infinity 运行 bge-m3，reranker 保留 Jina AI。

### 部署架构

```text
[用户] → nginx /infinity/ → proxy_pass → joymini-infinity:7997
                                  ↑                        ↑
                            api.joyminis.com          Docker 容器
                            /infinity/embeddings    michaelf34/infinity
                              （公网域名）           BAAI/bge-m3 模型
```

### 配置

**Docker 服务** (`compose.prod.yml`):
```yaml
infinity:
  image: michaelf34/infinity:latest
  container_name: joymini-infinity
  command: >
    v2 --model-id BAAI/bge-m3     # 只加载 bge-m3，不加 reranker
  volumes:
    - infinity_hf_cache:/root/.cache/huggingface
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:7997/health"]
    start_period: 480s            # 首次下载 bge-m3 ~2.2G 需要时间
  restart: unless-stopped
  networks: [app]
  deploy:
    resources:
      limits:
        memory: 3G
```

**不暴露端口**，通过 nginx 内部转发，使用现有域名 `api.joyminis.com`。

**Nginx 路由** (`nginx/conf.d/10-api.conf`):
```nginx
location ^~ /infinity/ {
    set $infinity_upstream http://joymini-infinity:7997;
    rewrite ^/infinity/(.*) /$1 break;
    proxy_pass $infinity_upstream;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

### 代码改动

**`infinity.provider.ts`**:
- 移除 `rerank()` 方法（让 duck-typing 自动找到 JinaProvider 做 reranker）
- `generateEmbedding()` 加 `options` 参数保持兼容

**`ai.module.ts`**: InfinityProvider 和 JinaProvider 双注册（Infinity 做 embedding，Jina 做 reranker）

**`ai.service.ts`**: InfinityProvider 放在 providers 数组 JinaProvider 前面，确保 `find(generateEmbedding)` 先找到 Infinity

**`.env.prod` / `.env.dev`**:
```env
INFINITY_EMBEDDING_BASE_URL=http://joymini-infinity:7997    # Docker 内部
INFINITY_EMBEDDING_MODEL=BAAI/bge-m3
# 本地开发连服务器：
INFINITY_EMBEDDING_BASE_URL=https://api.joyminis.com/infinity
```

### 效果
- bge-m3 1024 维向量，中英语义匹配质量明显优于 Jina embeddings-v5
- 只占 ~1.35 GiB 内存（单模型）
- reranker 不降级，继续走 Jina

---

## 改动二：MIN_SCORE 下调

### 背景
"查看可领取优惠"中文查询匹配英文 intent 示例得了 0.61，但 `MIN_SCORE=0.65` 拦住丢进 general chat。IntentClassifier 的阈值是 0.5，Orchestrator 额外拦一道 0.65，两个标准不一致。

### 改动

**`orchestrator.node.ts`**:
```typescript
// 改前
const MIN_SCORE = 0.65;

// 改后
const MIN_SCORE = 0.5;  // 和 IntentClassifier 阈值对齐
```

### 效果
- embedding 0.61 直接通过，不走 LLM fallback
- 不再有 0.5~0.65 的"死区"

---

## 改动三：BM25+vector 拆开 + 多意图 LLM 判断

### 背景
用户说"kyc"时：
- BM25（关键词）→ rag:1.0（文档里有"kyc"关键字）
- pgvector（语义）→ kyc:0.77
- 原先融合 + SCORE_GAP 只执行 rag，kyc 被忽略

### 改动 A：IntentClassifier 拆开融合

**`intent-classifier.ts`**：
```typescript
// 改前：BM25 和 vector 分数加权融合
const fusedScore = vectorScore * 0.8 + bm25Score * 0.2;

// 改后：各自独立，不融合
// vector 已有的 domain → 保留 vector 分数
// BM25 独有的 domain → 新增加入
// 同一 domain 两边都有 → vector 优先（语义比关键词更可靠）
```

移除了 `BM25_WEIGHT` 和 `VECTOR_WEIGHT` 常量。

### 改动 B：Orchestrator 多意图 LLM 判断

**`orchestrator.node.ts`**：
- 去掉 `SCORE_GAP` 比较
- 去重（同一 domain BM25+vector 各来一次，取最高分）
- 多 domain 时调 `decideMultiIntentWithLLM()`：

```typescript
// LLM 返回三种动作：
{ action: "single:kyc" }    → 用户意思明确，执行 kyc
{ action: "all" }            → 多意图，全部执行
{ action: "ask", message }   → 不确定，反问用户
```

LLM 收到：用户消息 + 匹配的 domain 列表 + `previousIntent` + 上一轮 AI 回复

### 完整流程

```text
改之前：
"kyc" → BM25 rag(1.0) + vector kyc(0.77) → 融合 rag 胜出
       → SCORE_GAP rag(1.0) > kyc(0.77) → 只执行 rag → ❌

改之后：
"kyc" → rag(1.0) + kyc(0.77) 独立
       → 多个 domain → LLM 判断
       → "不确定是查状态还是看政策"
       → 反问"您想查询KYC认证状态还是了解KYC政策？" ✅

"kyc status" → 明确 → single:kyc → kycAgent → getKycDetail ✅
```

### 关键文件

| 文件 | 改动 |
|------|------|
| `intent-classifier.ts:125-127` | 移除 BM25_WEIGHT、VECTOR_WEIGHT |
| `intent-classifier.ts:318-341` | BM25+vector 各自独立加入 |
| `orchestrator.node.ts:548-598` | MIN_SCORE=0.5，代替 MIN_SCORE=0.65+SCORE_GAP |
| `orchestrator.node.ts:118-195` | `decideMultiIntentWithLLM()` 新函数 |

### 效果

| 场景 | 改之前 | 改之后 |
|------|--------|--------|
| "kyc" | → rag 知识库（不对） | → 反问"查状态还是查政策" ✅ |
| "status"（追问） | → 多域匹配，又问一遍 | → 结合 previousIntent=kyc，走 kyc ✅ |
| "kyc status" | → 融合或 SCORE_GAP | → single:kyc 直通 ✅ |
| "查看可领取优惠" | → 0.61<0.65 进 general | → 0.61>0.5 直通 coupon ✅ |
