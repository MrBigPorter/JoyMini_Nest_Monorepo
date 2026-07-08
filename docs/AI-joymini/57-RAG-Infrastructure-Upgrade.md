# RAG Infrastructure Upgrade Plan

## Overview
为 JoyMini 开发环境（VPS Docker Compose）添加企业级 RAG 基础设施：
1. **Meilisearch** — BM25 关键词搜索（替代 Elasticsearch，内存降低 90%）
2. **pg_trgm** — PostgreSQL 模糊文本匹配（Meilisearch 不可用时的降级方案）
3. **bge-reranker-v2-m3** — Infinity 交叉编码器重排序服务

> ⚠️ 本方案仅针对 **开发环境**（VPS Docker Compose），生产环境（AWS ECS Fargate + RDS）不在此范围。

---

## Task 1: Meilisearch 到 compose.yml（替代 Elasticsearch）

**状态**: ✅ 已完成

### 为什么用 Meilisearch 替代 Elasticsearch？

| 方面 | Elasticsearch | Meilisearch |
|------|--------------|-------------|
| RAM | ~1.5-2GB（JVM 1GB + 系统开销） | **~100-256MB**（Rust 原生） |
| 镜像大小 | ~1.3GB | **~50MB** |
| 中文分词 | 需额外插件/analyzer 配置 | **内置**（按字切分） |
| BM25 | 可配置 | **内置（默认）** |
| 启动时间 | ~30-60s（JVM 预热） | **<5s** |
| API 复杂度 | REST + JSON DSL | 简单 HTTP REST |
| 配置复杂度 | 集群配置、JVM 调优 | 单二进制，无需配置 |

### 配置要点

[`compose.yml`](../../compose.yml) 已添加：

```yaml
meilisearch:
  image: getmeili/meilisearch:latest
  container_name: joymini-meilisearch
  ports:
    - "7700:7700"
  environment:
    - MEILI_MASTER_KEY=${MEILISEARCH_MASTER_KEY:-dev-master-key}
    - MEILI_NO_ANALYTICS=true
    - MEILI_ENV=development
  volumes:
    - meili_data:/meili_data
  healthcheck:
    test: ["CMD-SHELL", "curl -sf http://localhost:7700/health | grep -q 'status.*available' || exit 1"]
    interval: 10s
    timeout: 5s
    retries: 10
    start_period: 30s
  networks: [app]
```

| 项目 | 值 |
|------|-----|
| 镜像 | `getmeili/meilisearch:latest` |
| 容器名 | `joymini-meilisearch` |
| 端口 | `7700:7700` |
| 主密钥 | `MEILISEARCH_MASTER_KEY=dev-master-key` |
| 数据卷 | `meili_data:/meili_data` |
| 健康检查 | curl `/health` 状态为 available |

### 资源消耗估算

| 服务 | 之前 | 之后 |
|------|------|------|
| Elasticsearch | ~1.5-2GB | ❌ 移除 |
| Meilisearch | — | **~100-256MB** ✅ |
| **节省** | | **~1.2-1.7GB** |

8GB VPS 总量：现有服务 ~3.3GB + Meilisearch ~0.2GB + Infinity ~1.1GB = ~4.6GB，剩余 ~3.4GB 余量。

---

## Task 2: pg_trgm 迁移 SQL

**状态**: ✅ 已完成

[`apps/api/prisma/migrations/20260708000000_add_pg_trgm_extension/migration.sql`](../../apps/api/prisma/migrations/20260708000000_add_pg_trgm_extension/migration.sql)

```sql
-- Enable pg_trgm extension for fuzzy text matching (RAG fallback search)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create GIN index on RagChunk.content for trigram search
CREATE INDEX IF NOT EXISTS idx_rag_chunk_content_trgm ON "RagChunk" USING gin ("content" gin_trgm_ops);
```

### 说明
- **pg_trgm** 将 trigram（3-gram）分词，支持 `ILIKE`、`%`、`similarity()` 等模糊匹配
- 当 Meilisearch 不可用时，后端可降级使用 `SELECT * FROM "RagChunk" WHERE "content" % 'query'` 进行模糊搜索
- 迁移时间戳 `20260708000000` 确保在现有迁移之后执行

---

## Task 3: Infinity 专用 Rerank 服务（替代 Ollama /api/rerank）

**状态**: ✅ 已完成

### 背景

Ollama 的 `/api/rerank` 端点 **在 ARM64（Apple Silicon）上不可用**（Ollama 已知限制），且社区版 reranker 模型（`hans-tech/bge-reranker-v2-m3`）维护不稳定。因此引入 **Infinity** 作为专用 Rerank 推理服务。

### 方案对比

| 方案 | 类型 | ARM64 支持 | 说明 |
|------|------|-----------|------|
| Ollama `/api/rerank` | LLM 内置 | ❌ 不支持 | ARM64 无此端点 |
| **Infinity** | 专用 Rerank 服务 | ✅ 原生支持 | 选用方案 |
| TEI (Text Embeddings Inference) | 专用 Rerank 服务 | ❌ 需 GPU | HuggingFace 官方，生产级 |
| LlamaIndex | RAG 框架 | ✅ 纯代码 | 见附录 |

### 架构变更

```
之前:
  Ollama /api/rerank (ARM64 不可用) → 降级到 Embedding 余弦相似度

之后:
  Infinity /v1/rerank (Cohere 兼容) → 降级到 Embedding 余弦相似度
```

### 新增服务

[`compose.yml`](../../compose.yml) 新增 `infinity` 服务：

```yaml
infinity:
  image: michaelf34/infinity:latest
  container_name: joymini-infinity
  command: >
    v2 --model-id BAAI/bge-reranker-v2-m3
  ports:
    - "7997:7997"
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:7997/health"]
    interval: 10s
    timeout: 5s
    retries: 10
    start_period: 120s
  restart: unless-stopped
  networks: [app]
```

- **镜像**: `michaelf34/infinity:latest`（ARM64 原生支持）
- **模型**: `BAAI/bge-reranker-v2-m3`（~1.1GB，首次启动自动从 HuggingFace 下载）
- **端口**: `7997:7997`
- **API**: Cohere 兼容的 `/v1/rerank` 端点

### 环境变量

[`deploy/.env.dev`](../../deploy/.env.dev) 新增：

```env
RERANK_BASE_URL=http://joymini-infinity:7997
RERANK_MODEL=BAAI/bge-reranker-v2-m3
```

### 代码变更

[`ollama.provider.ts`](../../apps/api/src/common/ai/providers/ollama.provider.ts) 的 `rerank()` 方法：

```
1. RERANK_BASE_URL 已配置 → 请求 Infinity /v1/rerank → 成功返回结果
                                                      → 失败降级到 Embedding 余弦相似度
2. RERANK_BASE_URL 未配置 → 直接使用 Embedding 余弦相似度
```

关键代码（`tryDedicatedRerank` 方法）：

```typescript
private async tryDedicatedRerank(
  baseUrl: string,
  query: string,
  documents: string[],
): Promise<Array<{ index: number; relevance_score: number }> | null> {
  const url = `${baseUrl}/v1/rerank`;
  const model = this.configService.get<string>('RERANK_MODEL', 'BAAI/bge-reranker-v2-m3');
  const response = await axios.post(url, { model, query, documents }, { timeout: 30000 });
  // ...
}
```

### 启动方式

```bash
# 首次启动（自动下载 reranker 模型 ~1.1GB）
docker compose --env-file deploy/.env.dev up -d --build

# 监控模型下载进度
docker compose logs -f infinity

# 验证 rerank 正常工作
docker compose logs backend | grep "Dedicated reranker"
```

预期日志：
```
[Nest] XXX - [OllamaProvider] [rerank] Dedicated reranker (BAAI/bge-reranker-v2-m3) re-ranked N documents → N results
```

### RAG 流水线中的角色

```
用户查询 → BM25 (Meilisearch) + 向量搜索 (bge-m3) → 合并结果 → Infinity rerank → 最终结果
```

- **BM25 关键词搜索**: Meilisearch（精确匹配、关键词高亮，Rust 实现，~100MB 内存）
- **向量语义搜索**: bge-m3（1024 维向量，语义相似度，由 Ollama 提供）
- **交叉编码器重排序**: Infinity（BAAI/bge-reranker-v2-m3，对前 N 个结果重新打分排序）

---

## Task 4: Meilisearch BM25 集成到应用代码

**状态**: ✅ 已完成

### 新增文件

| 文件 | 说明 |
|------|------|
| [`apps/api/src/common/meilisearch/meilisearch.module.ts`](../../apps/api/src/common/meilisearch/meilisearch.module.ts) | 全局 Meilisearch 模块（`@Global()`），注册 `MeilisearchService` |
| [`apps/api/src/common/meilisearch/meilisearch.service.ts`](../../apps/api/src/common/meilisearch/meilisearch.service.ts) | Meilisearch 客户端封装：连接管理、索引管理、BM25 搜索、CRUD |

### 删除文件

| 文件 | 说明 |
|------|------|
| [`apps/api/src/common/elasticsearch/`](../../apps/api/src/common/elasticsearch/) | 整个 Elasticsearch 模块已移除 |

### 修改文件

| 文件 | 变更 |
|------|------|
| [`apps/api/src/app.module.ts`](../../apps/api/src/app.module.ts) | 导入 `MeilisearchModule`（替代 `ElasticsearchModule`） |
| [`apps/api/src/client/ai-customer/knowledge/rag-retrieval.service.ts`](../../apps/api/src/client/ai-customer/knowledge/rag-retrieval.service.ts) | 注入 `MeilisearchService`，在 Layer 1（pgvector）和 Layer 2（ILIKE）之间插入 Meilisearch BM25 作为 Layer 1.5 |
| [`apps/api/src/admin/rag/rag-embedding.service.ts`](../../apps/api/src/admin/rag/rag-embedding.service.ts) | 注入 `MeilisearchService`，在向量化完成后同步索引 chunk 到 Meilisearch |
| [`apps/api/package.json`](../../apps/api/package.json) | 移除 `@elastic/elasticsearch`，添加 `meilisearch` |
| [`compose.yml`](../../compose.yml) | 移除 `elasticsearch` 服务，添加 `meilisearch` 服务 |
| [`deploy/.env.dev`](../../deploy/.env.dev) | 添加 `MEILISEARCH_URL` 和 `MEILISEARCH_MASTER_KEY` |
| [`apps/api/.env`](../../apps/api/.env) | 替换 `ELASTICSEARCH_URL` 为 `MEILISEARCH_URL` |

### 架构变更

```
之前（4 层降级）:
  Layer 1:   pgvector 语义检索
  Layer 1.5: ES BM25 全文检索
  Layer 2:   ILIKE chunk 关键字检索（ES 不可用时降级）
  Layer 3:   全文文档关键字检索

之后（4 层降级，ES → Meilisearch）:
  Layer 1:   pgvector 语义检索
  Layer 1.5: Meilisearch BM25 全文检索 ← 替换
  Layer 2:   ILIKE chunk 关键字检索（Meilisearch 不可用时降级）
  Layer 3:   全文文档关键字检索
```

### Meilisearch BM25 搜索策略

- **搜索字段**: `content`, `title`（已配置为 searchableAttributes）
- **过滤属性**: `domain`, `docId`, `documentId`, `chunkIndex`, `priority`, `contentType`, `keywords`, `locale`, `isActive`
- **排序属性**: `chunkIndex`
- **降级策略**: Meilisearch 不可用时（连接失败、索引不存在）自动返回空结果，调用方降级到 ILIKE

### 数据同步流程

```
文档上传 → RagSyncService → RagChunkService（切片）
                                    ↓
                           RagEmbeddingProcessor（队列 Worker）
                                    ↓
                           RagEmbeddingService.embedSingleChunk()
                                    ↓
                           ┌──────────────────────────────┐
                           │ 1. generateEmbedding() → pgvector │
                           │ 2. indexChunk() → Meilisearch    │ ← 替换
                           └──────────────────────────────┘
```

### 依赖

- `meilisearch` — Meilisearch Node.js 客户端（替代 `@elastic/elasticsearch`）
- Meilisearch 地址通过环境变量 `MEILISEARCH_URL` 配置（默认 `http://joymini-meilisearch:7700`）

---

## 执行状态总结

| # | 任务 | 文件 | 状态 |
|---|------|------|------|
| 1 | 添加 Meilisearch（替代 Elasticsearch） | [`compose.yml`](../../compose.yml) | ✅ 已完成 |
| 2 | 创建 pg_trgm 迁移 | [`apps/api/prisma/migrations/20260708000000_add_pg_trgm_extension/migration.sql`](../../apps/api/prisma/migrations/20260708000000_add_pg_trgm_extension/migration.sql) | ✅ 已完成 |
| 3 | Infinity 专用 Rerank 服务 | [`compose.yml`](../../compose.yml) + [`ollama.provider.ts`](../../apps/api/src/common/ai/providers/ollama.provider.ts) + [`deploy/.env.dev`](../../deploy/.env.dev) | ✅ 已完成 |
| 4 | Meilisearch BM25 集成到应用代码 | [`apps/api/src/common/meilisearch/`](../../apps/api/src/common/meilisearch/) + 7 文件修改 | ✅ 已完成 |

---

## 附录 A: LlamaIndex — 学习笔记

[**LlamaIndex**](https://www.llamaindex.ai/) 是一个专门为 **RAG（检索增强生成）** 场景设计的 **数据框架（Data Framework）**，由 Jerry Liu 创建。它不是推理服务器（如 Infinity/TEI），而是一个 **Python/TypeScript 库**，用于构建连接 LLM 与外部数据的管道。

### 核心定位

```
你的数据 (PDF, DB, API, 网页...) → LlamaIndex → LLM
```

### 主要功能

| 功能 | 说明 |
|------|------|
| **数据接入（Data Ingestion）** | 从 PDF、数据库、Notion、Slack、网页等 160+ 数据源加载数据 |
| **文档解析（Parsing）** | 自动分割文档为 chunks，支持多种分割策略 |
| **索引构建（Indexing）** | 构建向量索引、关键词索引、树索引、知识图谱索引等 |
| **检索（Retrieval）** | 支持向量检索、BM25、混合检索、重排序（rerank） |
| **查询引擎（Query Engine）** | 将检索结果 + Prompt 组装后发给 LLM |
| **Agent 能力** | 支持工具调用、多步推理、路由等 |

### 切片策略（核心功能）

LlamaIndex 提供多种文档切片策略，比你手写的更灵活：

```python
from llama_index.core.node_parser import (
    SentenceSplitter,           # 按句子切（最常用）
    TokenTextSplitter,          # 按 token 数切
    SemanticSplitterNodeParser, # 按语义切（高级）
)

# 配置切片
parser = SentenceSplitter(
    chunk_size=512,        # 每块 512 token
    chunk_overlap=50,      # 重叠 50 token（避免切断关键信息）
)
nodes = parser.get_nodes_from_documents(documents)
```

### 企业用户

| 公司 | 用途 |
|------|------|
| **Notion** | AI 问答（Notion AI 的 RAG 底层） |
| **Uber** | 内部知识库检索 |
| **Spotify** | 播客内容检索 |
| **Adobe** | 文档助手 |

### 与本项目的关系

```
LlamaIndex (框架层 - RAG 管道编排)
    ↓ 调用
Infinity / TEI (推理服务层 - Embedding + Rerank 模型推理)
    ↓ 调用
Ollama / OpenAI (LLM 层 - 生成回答)
```

### 为什么不引入本项目

LlamaIndex 是**好技术**，但与本项目的 **NestJS + Prisma** 架构不兼容：

| 本项目的 RAG 管道 | LlamaIndex TS 能替代？ |
|---------|---------------------|
| 文档切片 | ✅ 能（但已成熟） |
| Embedding（AiService 封装） | ✅ 能（但底层还是调 Ollama） |
| 向量存储（Prisma + pgvector） | ❌ Schema 不兼容 |
| 向量检索（PGVector `<->`） | ❌ Schema 不兼容 |
| 关键词检索（Meilisearch） | ❌ TS 版不支持 |
| 混合检索融合 | ❌ TS 版不支持 |
| Rerank（Infinity） | ❌ 已用 Infinity 最优方案 |

**结论**: LlamaIndex 适合 **Python 项目 + 从零开始建 RAG** 的场景。本项目已有完整的、与 Prisma 深度集成的 RAG 管道，强行引入反而破坏现有架构。后续有时间可以学习 Python 版 LlamaIndex。
