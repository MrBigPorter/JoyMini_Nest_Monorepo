# 13. Prisma Knowledge 模型 + pgvector（当前架构）

> ⚠️ **本文档已更新至当前实现**（2026-07-08）。
> 旧版内容（KnowledgeEmbedding 模型 + mxbai-embed-large 768d + KnowledgeSyncService 文件同步）已被以下内容替代。

## 🎯 本步骤目标

1. 在 Prisma schema 中定义 `KnowledgeDocument` 和 `DocumentChunk` 模型
2. 配置 pgvector 扩展（`vector(1024)` 维度匹配 bge-m3）
3. 文档通过 Admin 面板上传 → 切片 → 向量化 → 存储

---

## 📖 为什么改版

| 旧架构 | 新架构 | 原因 |
|:-------|:-------|:------|
| `KnowledgeEmbedding` 模型 | **`DocumentChunk`** 模型 | 更清晰的命名，支持更多元数据 |
| mxbai-embed-large 768d | **bge-m3 1024d** | 多语言支持更好，精度更高 |
| `KnowledgeSyncService` 读文件 | **Admin 面板上传** | 可视化操作，无需脚本 |
| 段落分块 500 字 | **RecursiveCharacterTextSplitter** | LangChain 标准，按 Markdown 标题层级切 |
| 同步脚本 | **REST API + BullMQ 队列** | 异步处理，不阻塞上传 |

---

## 🔧 当前架构

### 数据模型

```prisma
// ============================================
// Knowledge Base Models（AI 客服知识库）
// ============================================

/// 知识文档 — 用于 AI Customer Service RAG 检索
model KnowledgeDocument {
  id           String          @id @default(cuid()) @db.VarChar(32)
  title        String
  domain       String?         // 所属域: wallet/order/product/...（对应 Agent tag）
  docId        String          // 文档唯一标识（如 "withdrawal-guide"）
  keywords     String[]
  locale       String          @default("en")
  contentType  String          @default("policy") // policy / how-to / faq / troubleshooting
  priority     String          @default("P2")     // P0 / P1 / P2
  content      String          @db.Text           // Markdown 原文
  version      Int             @default(1)
  isActive     Boolean         @default(true)
  createdAt    DateTime        @default(now())
  updatedAt    DateTime        @updatedAt

  chunks       DocumentChunk[]

  @@unique([docId, locale])
  @@index([domain, isActive])
  @@map("knowledge_documents")
}

/// 知识文档切片 — 每个切片包含原文 + 向量 embedding
model DocumentChunk {
  id              String                       @id @default(cuid()) @db.VarChar(32)
  documentId      String                       @map("document_id")
  chunkIndex      Int                          @map("chunk_index") @db.SmallInt
  content         String                       @map("content") @db.Text
  embedding       Unsupported("vector(1024)")? // bge-m3 1024 维向量
  tokenCount      Int?                         @map("token_count") @db.SmallInt
  documentVersion Int                          @default(1)
  createdAt       DateTime                     @default(now()) @map("created_at")
  updatedAt       DateTime                     @updatedAt @map("updated_at")

  document KnowledgeDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([documentId])
  @@map("document_chunks")
}
```

### 关键字段说明

| 字段 | 说明 |
|:-----|:------|
| `domain` | 文档所属业务域（wallet/order/product/...），搜索时用于过滤 |
| `docId + locale` | 联合唯一键，同 slug 不同语言可共存 |
| `priority` | P0=核心政策 / P1=操作指南 / P2=一般信息 |
| `contentType` | policy / how-to / faq / troubleshooting |
| `embedding` | `vector(1024)` 由 bge-m3 模型生成 |
| `documentVersion` | 每次更新文档时 +1，用于追踪 chunk 版本 |

### 向量维度对齐

| 组件 | 维度 | 说明 |
|:-----|:----:|:------|
| bge-m3 (Ollama) | 1024 | 当前使用的 embedding 模型 |
| `vector(1024)` | 1024 | pgvector 存储维度，必须匹配 |
| 余弦相似度 | - | pgvector `<=>` 运算符 |

---

## ⚙️ 完整数据流

```
上传 .md/.pdf (Admin 面板)
        ↓
① ragSyncService.uploadFile()
   ├─ MarkdownExtractor / PdfExtractor 提取文本
   ├─ 解析 frontmatter 元数据
   └─ upsert 到 knowledge_documents 表
        ↓
② ragChunkService.chunkText()
   └─ RecursiveCharacterTextSplitter 按 Markdown 标题层级切分
        ↓
③ 提交 BullMQ 任务到 rag-embedding 队列
   └─ 异步处理，不阻塞上传
        ↓
④ RagEmbeddingProcessor (Worker)
   └─ embedDocument() → p-limit(2) 并发
        ├─ bge-m3 → 向量 → UPDATE pgvector
        └─ Meilisearch.indexChunk() → BM25 索引
```

### 上传方式

**推荐**: Admin 面板拖拽上传 (`/knowledge`)
- 支持 `.md` 和 `.pdf`
- 自动解析 frontmatter（title/domain/keywords/...）
- 自动切片 + 向量化 + BM25 索引

**API 方式**:
```bash
# 上传 Markdown 文件
curl -X POST /api/v1/admin/rag/documents/upload \
  -F "file=@refund-policy.en.md" \
  -F "domain=order"

# 手动创建文档（纯文本）
curl -X POST /api/v1/admin/rag/documents \
  -H "Content-Type: application/json" \
  -d '{"title":"Refund Policy","domain":"order","content":"..."}'
```

---

## 🔍 搜索流程（4 层多路召回）

```
用户提问 "取款手续费"
        ↓
RagRetrievalService.retrieve()
  ├─ Layer 1:   pgvector 语义检索      → 20 条
  ├─ Layer 1.5: Meilisearch BM25 关键词 → 8 条
  ├─ Layer 2:   ILIKE 关键字            → 0 条
  └─ Layer 3:   全文文档                → 0 条
        ↓
  合并去重 → 28 条候选
        ↓
  Infinity Rerank (bge-reranker-v2-m3)
        ↓
  TOP-3 → LLM 生成回答
```

---

## 🔜 下一步

这篇文档对应的 Prisma 模型和 pgvector 已全部完成。当前 RAG 系统已在生产环境运行，包含:

- ✅ `KnowledgeDocument` + `DocumentChunk` 模型
- ✅ `vector(1024)` pgvector 向量存储
- ✅ 4 层多路召回（pgvector + Meilisearch + ILIKE + 全文）
- ✅ Infinity 交叉编码器 rerank
- ✅ Admin 面板文档管理（CRUD + 上传 + Reindex）
- ✅ BullMQ 异步向量化队列
- ✅ 删除/Reindex 时 Meilisearch 同步清理
