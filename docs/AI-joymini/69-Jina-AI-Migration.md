# 69 — Jina AI 迁移方案：替换本地 Infinity

## 背景

本地 Docker 运行 **Infinity**（bge-m3 embedding + bge-reranker-v2-m3 reranker），
占用 ~1.5GB 内存。替换为 **Jina AI** 线上免费 API，省掉 Infinity 容器的资源消耗。

### 替换范围

| 组件 | 本地 → | 线上 |
|------|:-----:|:----:|
| **Embedding**（bge-m3, 1024维） | Infinity Docker | Jina Embeddings v3 |
| **Reranker**（bge-reranker-v2-m3） | Infinity Docker | Jina Reranker v2 |

### 不动

- **Meilisearch**（BM25）— 保留本地
- **Unstructured**（PDF 解析）— 保留本地
- **OllamaProvider** — 保留代码但已不启用（DeepSeek 替代了文本生成）

## Jina AI 免费额度

### 每个账户

| API | 速率 | Token/分钟 | 每日限额 |
|-----|:----:|:----------:|:--------:|
| Embedding | 100 RPM | 100K TPM | 1M tokens |
| Reranker  | 100 RPM | 100K TPM | 1M tokens |

### 多账户轮询

`JINA_API_KEY` 支持逗号分隔多个 Key，自动轮询：

```bash
JINA_API_KEY=jina_xxx1,jina_xxx2,jina_xxx3,jina_xxx4
```

N 个账户 = N × 100 RPM / 100K TPM。
被 429 限流自动切下一个 Key，60s 后恢复。

### 够不够用

典型 RAG 查询：
- Embedding（用户问题 ~50 tokens）：单次扣 50 tokens
- Reranker（query + 20 chunks ~10050 tokens）：单次扣 ~10K tokens

一个账户每分钟可处理约 10 次完整 RAG 查询。4 个账户 ≈ 40 次/分钟。
开发测试绰绰有余。

注册: [jina.ai](https://jina.ai) → 拿 API Key

## API 格式

### Embedding

```
POST https://api.jina.ai/v1/embeddings
Authorization: Bearer <JINA_API_KEY>
Content-Type: application/json

{
  "model": "jina-embeddings-v3",
  "input": "要向量化的文本",
  "dimensions": 1024
}
```

响应：
```json
{
  "data": [{ "object": "embedding", "index": 0, "embedding": [0.1, 0.2, ...] }],
  "usage": { "total_tokens": 10 }
}
```

### Reranker

```
POST https://api.jina.ai/v1/rerank
Authorization: Bearer <JINA_API_KEY>
Content-Type: application/json

{
  "model": "jina-reranker-v2-base-multilingual",
  "query": "用户问题",
  "documents": ["候选文档1", "候选文档2"]
}
```

响应：
```json
{
  "model": "jina-reranker-v2-base-multilingual",
  "results": [
    { "index": 0, "relevance_score": 0.95, "document": { "text": "文档1" } },
    { "index": 1, "relevance_score": 0.87, "document": { "text": "文档2" } }
  ]
}
```

## 改动清单

### 新增文件
- `apps/api/src/common/ai/providers/jina.provider.ts` — Jina Provider 类（248 行）

### 修改文件
- `apps/api/src/common/ai/ai.module.ts` — 注册 JinaProvider
- `apps/api/src/common/ai/ai.service.ts` — 注入 JinaProvider
- `apps/api/src/admin/services/health.service.ts` — 替换健康检查
- `deploy/.env.dev` — 加 JINA_API_KEY、注释 Infinity 配置
- `deploy/.env.prod` — 同上
- `deploy/.env.example` — 同上
- `apps/api/.env` — 加 JINA_API_KEY
- `compose.yml` — 注释 Infinity 服务
- `Makefile` — 清理 Infinity 相关 target

### 原则
> **注释不删** — 所有 Infinity 配置、Docker 服务、环境变量都注释掉而非删除。
> 切回来只需取消注释，不用重新踩坑。

## JinaProvider 设计

```typescript
@Injectable()
export class JinaProvider implements AiProviderInstance {
  readonly name = 'jina';
  readonly displayName = 'Jina AI';
  readonly models = ['jina-embeddings-v3', 'jina-reranker-v2-base-multilingual'];
  activeModel = 'jina-embeddings-v3';

  // 多账户支持 — 每个 Key 独立计费
  private keyInstances: {
    keySuffix: string;
    apiKey: string;
    dailyTokens: number;
    dailyRequests: number;
    blocked: boolean;
    blockedUntil: number;
  }[] = [];

  async generateText(): Promise<string | null> { return null; }

  // Embedding — 自动轮询多 Key，429 自动切下一个
  async generateEmbedding(text: string): Promise<number[] | null> {
    for (let attempt = 0; attempt < totalKeys; attempt++) {
      const key = this.getCurrentKey();
      if (key.blocked || key.dailyTokens >= LIMIT) {
        this.rotateToNextKey(); continue;
      }
      // POST /v1/embeddings
    }
  }

  // Reranker — 同上，自动轮询
  async rerank(query: string, documents: string[]): Promise<number[] | null> {
    // POST /v1/rerank → 返回排序后的 index 数组
  }
}
```

## 数据流

```
用户提问 → intent-classifier.ts
  └─ generateEmbedding() → Jina API → pgvector 余弦相似度 → 意图分类

用户提问 → rag-retrieval.service.ts
  ├─ Layer 1: generateEmbedding() → Jina API → pgvector 语义检索
  ├─ Layer 1.5: Meilisearch BM25（本地）
  ├─ Layer 2: PostgreSQL ILIKE（本地）
  ├─ Layer 3: 全文档扫（本地）
  └─ Reranker: rerank() → Jina API → 合并重排序
```

## 验证步骤

1. 类型检查: `yarn workspace @lucky/api tsc --noEmit --pretty`
2. `/health` 端点: Jina 状态 available
3. AI 对话: embedding + reranker 走 Jina API
4. Intent 分类正常
5. 后台文档上传 + RAG 检索正常

## 参考

- Jina AI API 文档: https://docs.jina.ai
- Jina Embeddings v3: https://jina.ai/embeddings
- Jina Reranker: https://jina.ai/reranker
- 原 Infinity 配置: `compose.yml`（已注释）
- 原 Infinity Provider: `apps/api/src/common/ai/providers/infinity.provider.ts`
