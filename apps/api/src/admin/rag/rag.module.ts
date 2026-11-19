import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { UploadModule } from '@api/common/upload/upload.module';
import { RagController } from './rag.controller';
import { RagService } from './rag.service';
import { RagSyncService } from './rag-sync.service';
import { RagChunkService } from './rag-chunk.service';
import { RagEmbeddingService } from './rag-embedding.service';
import { RagEmbeddingQueueModule } from './rag-embedding-queue.module';
import { RagQualityService } from './rag-quality.service';
import { RagVersionPurgeTask } from './rag-version-purge.task';
import { RagRetrievalService } from '@api/client/ai-customer/knowledge/rag-retrieval.service';
import { RagFaithfulnessService } from './rag-faithfulness.service';

@Module({
  imports: [PrismaModule, RagEmbeddingQueueModule, UploadModule],
  controllers: [RagController],
  providers: [
    RagService,
    RagSyncService,
    RagChunkService,
    RagEmbeddingService,
    RagQualityService,
    RagVersionPurgeTask,
    // 管理端检索调试/评测用；AiService / MeilisearchService 是全局模块
    RagRetrievalService,
    RagFaithfulnessService,
  ],
  exports: [RagChunkService, RagEmbeddingService, RagQualityService],
})
export class RagModule {}
