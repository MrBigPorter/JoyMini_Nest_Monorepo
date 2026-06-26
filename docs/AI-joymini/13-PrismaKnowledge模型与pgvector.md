# 13. Prisma Knowledge 模型 + pgvector 设置

## 🎯 本步骤目标

1. 在 Prisma schema 中定义 `KnowledgeDocument` 和 `KnowledgeEmbedding` 模型
2. 配置 pgvector 扩展（`vector(768)` 维度匹配 mxbai-embed-large）
3. 创建数据导入脚本（将 .md 文件导入数据库 + 生成嵌入向量）
4. 创建同步服务 `KnowledgeSyncService`

完成本步骤后，知识库数据存储在 PostgreSQL 中，带有向量嵌入，Phase 3（文档 17）可以直接使用 pgvector 进行语义搜索。

---

## 📖 开发背景

### 承上：上一步做了什么？

[12-政策知识文档与RAGStub.md](12-政策知识文档与RAGStub.md) 完成了：
- 创建 8 个政策知识 Markdown 文档
- 更新 `rag.node.ts` — Phase 1 静态文档关键词匹配
- 建立知识库目录结构

### 启下：下一步做什么？

下一步进入 **Phase 4：前端 UI**：

| # | 文档 | 内容 |
|---|------|------|
| 14 | [AI Chat API + Controller + SSE](14-AIChatAPI与ControllerSSE.md) | SSE 流式 API |
| 15 | [前端 Chat 页面](15-前端Chat页面.md) | Server Component |
| 16 | [前端 Chat Client + Hook](16-前端ChatClient与useAiChatHook.md) | Client Component + Hook |

### 向量嵌入架构

```
Markdown 文件                    PostgreSQL
┌──────────────┐               ┌──────────────────────┐
│ refund-policy│───导入脚本────►│ KnowledgeDocument    │
│ shipping-pol │   (本步骤)     │   id, title, content │
│ coupon-rules │               │   category, createdAt│
│ ...          │               └──────────┬───────────┘
└──────────────┘                          │
                                          │ 1:N
                                  ┌───────▼───────────┐
                                  │ KnowledgeEmbedding│
                                  │   id, documentId  │
                                  │   embedding(vector│
                                  │   chunkIndex      │
                                  │   chunkText       │
                                  └───────────────────┘
```

---

## 🔧 前提条件

- [x] 12 文档已完成（8 个政策知识文档）
- [x] PostgreSQL 已安装 pgvector 扩展
- [x] mxbai-embed-large 模型已拉取（`ollama pull mxbai-embed-large`）
- [x] AiService 的 `generateEmbedding()` 方法可用

---

## ⚙️ 实现步骤

### Step 1: 确认 pgvector 扩展已安装

```bash
# 检查 pgvector 是否已安装
psql -U postgres -d joymini -c "SELECT * FROM pg_extension WHERE extname = 'vector';"

# 如果没有安装，以超级用户身份运行：
# CREATE EXTENSION vector;
```

### Step 2: 更新 Prisma Schema

**文件**: `apps/api/prisma/schema.prisma`

```prisma
// ============================================
// Knowledge Base Models（AI 客服知识库）
// ============================================

/// 知识库文档（政策文件、规则说明等）
model KnowledgeDocument {
  id        String   @id @default(cuid())
  title     String   @unique // 文档标题（对应文件名，如 "refund-policy"）
  category  String?  // 分类：refund / shipping / coupon / group / lucky-draw / kyc / vip / privacy
  content   String   @db.Text // Markdown 原始内容
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  embeddings KnowledgeEmbedding[] // 文档的分块嵌入向量

  @@map("knowledge_documents")
}

/// 知识文档分块嵌入向量
model KnowledgeEmbedding {
  id         String   @id @default(cuid())
  documentId String   // 所属文档 ID
  chunkIndex Int      // 分块序号
  chunkText  String   @db.Text // 分块文本
  embedding  Unsupported("vector(768)")? // 嵌入向量（768 维，匹配 mxbai-embed-large）
  
  document KnowledgeDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@unique([documentId, chunkIndex])
  @@index([documentId])
  @@map("knowledge_embeddings")
}
```

### Step 3: 生成 Prisma 迁移

```bash
# 生成迁移文件
npx prisma migrate dev --name add-knowledge-models

# 生成 Prisma Client
npx prisma generate
```

### Step 4: 创建 KnowledgeSyncService

**文件**: `apps/api/src/client/ai-customer/knowledge-sync.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { AiService } from '@api/common/ai/ai.service';

@Injectable()
export class KnowledgeSyncService {
  private readonly logger = new Logger(KnowledgeSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  /**
   * 将 knowledge/ 目录下的所有 .md 文件导入数据库
   */
  async syncFromFiles(knowledgeDir: string) {
    if (!fs.existsSync(knowledgeDir)) {
      this.logger.warn(`Knowledge directory not found: ${knowledgeDir}`);
      return;
    }

    const files = fs
      .readdirSync(knowledgeDir)
      .filter((f) => f.endsWith('.md'))
      .sort();

    this.logger.log(`Found ${files.length} knowledge files to sync`);

    for (const file of files) {
      const title = file.replace(/\.md$/, '');
      const content = fs.readFileSync(path.join(knowledgeDir, file), 'utf-8');
      const category = this.inferCategory(title);

      await this.upsertDocument(title, category, content);
    }

    this.logger.log('Knowledge sync completed');
  }

  /**
   * 根据文件名推断分类
   */
  private inferCategory(title: string): string {
    const map: Record<string, string> = {
      'refund-policy': 'refund',
      'shipping-policy': 'shipping',
      'coupon-rules': 'coupon',
      'group-rules': 'group',
      'lucky-draw-rules': 'lucky-draw',
      'kyc-rules': 'kyc',
      'vip-benefits': 'vip',
      'privacy-policy': 'privacy',
    };
    return map[title] || 'general';
  }

  /**
   * 创建或更新文档及其嵌入向量
   */
  private async upsertDocument(title: string, category: string, content: string) {
    // 1. 创建或更新文档
    const document = await this.prisma.knowledgeDocument.upsert({
      where: { title },
      create: { title, category, content },
      update: { content, category, updatedAt: new Date() },
    });

    // 2. 删除旧的嵌入向量
    await this.prisma.knowledgeEmbedding.deleteMany({
      where: { documentId: document.id },
    });

    // 3. 将文档分块（按段落分块）
    const chunks = this.chunkContent(content);

    // 4. 为每个分块生成嵌入向量
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = await this.aiService.generateEmbedding(chunk);

      if (embedding) {
        await this.prisma.knowledgeEmbedding.create({
          data: {
            documentId: document.id,
            chunkIndex: i,
            chunkText: chunk,
            embedding: embedding as any, // vector(768) type
          },
        });
      }
    }

    this.logger.log(`Synced document: ${title} (${chunks.length} chunks)`);
  }

  /**
   * 将 Markdown 内容分块
   * 按段落（空行分隔）分块，每个分块不超过 500 字符
   */
  private chunkContent(content: string): string[] {
    const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 0);
    const chunks: string[] = [];
    let current = '';

    for (const p of paragraphs) {
      if ((current + p).length > 500 && current.length > 0) {
        chunks.push(current.trim());
        current = p;
      } else {
        current += '\n\n' + p;
      }
    }

    if (current.trim().length > 0) {
      chunks.push(current.trim());
    }

    return chunks;
  }
}
```

### Step 5: 创建数据导入脚本

**文件**: `scripts/sync-knowledge.ts`

```typescript
/**
 * 知识库同步脚本
 *
 * 使用方法：
 * npx ts-node scripts/sync-knowledge.ts
 *
 * 功能：
 * 1. 读取 apps/api/src/client/ai-customer/knowledge/ 下的所有 .md 文件
 * 2. 导入到 KnowledgeDocument 表
 * 3. 分块后调用 AiService.generateEmbedding() 生成嵌入向量
 * 4. 存储到 KnowledgeEmbedding 表
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@api/app.module';
import { KnowledgeSyncService } from '@api/client/ai-customer/knowledge-sync.service';
import * as path from 'path';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const syncService = app.get(KnowledgeSyncService);

  const knowledgeDir = path.join(
    __dirname,
    '../apps/api/src/client/ai-customer/knowledge',
  );

  console.log('Starting knowledge sync...');
  await syncService.syncFromFiles(knowledgeDir);
  console.log('Knowledge sync completed!');

  await app.close();
}

bootstrap().catch((err) => {
  console.error('Knowledge sync failed:', err);
  process.exit(1);
});
```

### Step 6: 注册 KnowledgeSyncService 到 AiCustomerModule

```diff
// ai-customer.module.ts
+ import { KnowledgeSyncService } from './knowledge-sync.service';

@Module({
  providers: [
    AiCustomerService,
+   KnowledgeSyncService,
  ],
})
export class AiCustomerModule {}
```

---

## ✅ 验证

```bash
# 1. 检查 Prisma 迁移
npx prisma migrate status

# 2. 运行同步脚本
npx ts-node scripts/sync-knowledge.ts

# 3. 验证数据已导入
npx prisma studio
# 检查 knowledge_documents 和 knowledge_embeddings 表

# 4. 验证嵌入向量
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function check() {
  const docs = await prisma.knowledgeDocument.findMany();
  console.log('Documents:', docs.length);
  for (const doc of docs) {
    const embeds = await prisma.knowledgeEmbedding.findMany({
      where: { documentId: doc.id },
    });
    console.log(\`\${doc.title}: \${embeds.length} chunks\`);
  }
  await prisma.\$disconnect();
}
check();
"
```

---

## 📝 技术要点

### 向量维度对齐

| 组件 | 维度 | 说明 |
|------|------|------|
| mxbai-embed-large | 768 | Ollama 嵌入模型输出维度 |
| `vector(768)` | 768 | pgvector 存储维度，必须匹配 |
| 余弦相似度搜索 | - | pgvector 支持的向量距离函数 |

维度不匹配会导致数据库错误，必须保持一致。

### 分块策略

当前采用简单的**段落分块**策略：
- 按空行分隔段落
- 每个分块不超过 500 字符
- 保持段落完整性

Phase 3（文档 17）可以优化为：
- 语义分块（基于标题层级）
- 重叠分块（避免信息丢失）
- 自适应分块大小

### Upsert 策略

`upsertDocument` 使用 `prisma.knowledgeDocument.upsert`：
- 如果 `title` 已存在 → 更新内容并重新生成嵌入
- 如果 `title` 不存在 → 创建新记录

这样可以安全地重复执行同步脚本，不会产生重复数据。

---

## 🔜 下一步预告

Phase 3（知识库）至此完成！接下来进入 **Phase 4：前端 UI**。

在 [14-AIChatAPI与ControllerSSE.md](14-AIChatAPI与ControllerSSE.md) 中，我们将：
- 实现 `ai-customer.controller.ts` — SSE 流式 API 端点
- 实现 `ai-customer.service.ts` — Graph 的 streamEvents 调用
- 处理 SSE 事件格式（token、step、done、error）
- 前端使用 fetchEventSource 消费 SSE
