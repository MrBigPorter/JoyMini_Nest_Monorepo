# 58. PDF 解析方案 — Unstructured 集成设计

> **状态**: 设计文档
> **日期**: 2026-07-08
> **相关**: [57-RAG-Infrastructure-Upgrade](57-RAG-Infrastructure-Upgrade.md)

---

## 一、背景

知识库上传功能当前只支持 `.md` 文件，PDF 解析虽然代码中有 `PdfExtractor`，但:

1. 依赖 `pdf-parse` 库未安装 → 上传 PDF 报错
2. `pdf-parse` 不支持扫描件/表格/多栏排版
3. 没有 Unstructured 企业级解析方案

---

## 二、方案选择

| 方案 | 资源占用 | 免费额度 | OCR | 部署方式 |
|:-----|:--------:|:--------:|:---:|:---------|
| **Unstructured 本地** | ~2GB RAM + ~4GB 磁盘 | 无限 | ✅ | Docker 手动启停 |
| Unstructured SaaS | 0 | 1000页/月 | ✅ | API Key |
| LlamaParse SaaS | 0 | 1000页/天 | ✅ | API Key |
| pdf-parse | ~2MB | 无限 | ❌ | npm 包 |

**选择: Unstructured 本地部署，手动启停**

理由:
- 数据不出服务器（政策文档可能包含敏感信息）
- 无限免费使用
- 只在需要时启动，不占用常驻内存
- 支持 OCR、表格、多栏排版

---

## 三、架构设计

### 3.1 处理流程（分步状态机）

```
上传 PDF → 存储原始文件
    ↓（状态: uploaded）
用户点"解析" → 启动 Unstructured → 解析 PDF → 停 Unstructured
    ↓（状态: parsed）
用户点"切片" → chunkText()
    ↓（状态: chunked）
用户点"向量化" → 启动 Ollama → 生成 embedding → 停 Ollama
    ↓（状态: embedded）
用户点"索引" → BM25 indexChunk
    ↓（状态: completed）
```

### 3.2 状态字段

在 `knowledge_documents` 表增加 `process_status` 字段:

```prisma
model KnowledgeDocument {
  // ... 现有字段 ...
  
  /// 处理状态: uploaded → parsed → chunked → embedded → indexed
  processStatus String @default("uploaded")
  
  /// 解析后的纯文本（Unstructured 输出）
  parsedContent String? @db.Text
}
```

### 3.3 Admin 面板流程

```
┌──────────────────────────────────────────────┐
│  文档: withdrawal-guide.pdf                   │
│  状态: ████████░░░░ 已解析 (2/3)              │
│                                               │
│  [解析] [切片] [向量化] [索引]                │
│   ✅      ⏳      ⬜      ⬜                   │
│                                               │
│  启动服务: docker compose up -d unstructured   │
│  停止服务: docker compose stop unstructured    │
└──────────────────────────────────────────────┘
```

---

## 四、改动清单

### 4.1 compose.yml

```yaml
unstructured:
  profiles: ["manual"]  # 不会随 docker compose up -d 启动
  image: downloads.unstructured.io/unstructured-io/unstructured-api:latest
  container_name: joymini-unstructured
  ports:
    - "8000:8000"
  command: ["--port", "8000", "--workers", "2"]
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 60s  # 首次启动要下载模型，需要更长时间
  restart: "no"        # 手动启停，不自动重启
  networks: [app]
```

### 4.2 Makefile

```makefile
## [PDF] 🚀 Start Unstructured PDF parser
start-unstructured:
	docker compose up -d unstructured

## [PDF] ⏹️ Stop Unstructured PDF parser
stop-unstructured:
	docker compose stop unstructured

## [PDF] 📋 Check Unstructured status
unstructured-status:
	docker compose ps unstructured
```

### 4.3 PdfExtractor 改造

**文件**: [`rag-sync.service.ts`](../../apps/api/src/admin/rag/rag-sync.service.ts)

```typescript
class UnstructuredExtractor implements TextExtractor {
  canHandle(filename: string): boolean {
    return filename.endsWith('.pdf');
  }

  async extract(file: Express.Multer.File): Promise<ExtractedDoc> {
    const UNSTRUCTURED_URL = process.env.UNSTRUCTURED_URL 
      || 'http://joymini-unstructured:8000';

    // 如果是扫描件或 pdf-parse 提取不到文本，尝试 Unstructured
    if (await this.needsOcr(file)) {
      return this.extractWithUnstructured(file, UNSTRUCTURED_URL);
    }
    // 文字型 PDF 用 pdf-parse（快）
    return this.extractWithPdfParse(file);
  }
}
```

> 注意: `pdf-parse` 需要安装: `yarn add pdf-parse`

### 4.4 前端改动

**文件**: [`KnowledgeBaseClient.tsx`](../../apps/admin-next/src/components/knowledge/KnowledgeBaseClient.tsx)

- 文档详情展示 `processStatus` 状态
- 每个步骤显示独立按钮（可点击/不可点击状态）
- 上传成功后显示"待解析"，引导用户操作

---

## 五、执行步骤

| 步骤 | 内容 | 工作量 |
|:-----|:------|:------:|
| 1 | 添加 Unstructured 到 compose.yml | ~10行 |
| 2 | 添加 Makefile 命令 | ~5行 |
| 3 | 安装 pdf-parse 依赖 | ~1分钟 |
| 4 | 改造 PdfExtractor → UnstructuredExtractor | ~50行 |
| 5 | Prisma 加 processStatus 字段 + 迁移 | ~30行 |
| 6 | 修改 rag.service.ts 处理状态流转 | ~80行 |
| 7 | Admin 面板显示状态 + 操作按钮 | ~100行 |

---

## 六、日常使用

```bash
# 上传 PDF
1. 打开 Admin 面板 /knowledge
2. 上传 PDF 文件
3. 文档状态显示 "已上传"

# 解析 PDF
4. ssh 登录服务器
5. make start-unstructured   # 启动（首次需等 ~2分钟下载模型）
6. 在 Admin 面板点 "解析"    # 调用 Unstructured API
7. make stop-unstructured    # 解析完毕关掉

# 后续步骤（不需要额外服务）
8. 点 "切片" → 自动完成
9. 点 "向量化" → 需要 Ollama（常开）
10. 点 "索引" → 需要 Meilisearch（常开）
```
