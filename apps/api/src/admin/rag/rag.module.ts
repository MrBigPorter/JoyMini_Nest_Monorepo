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

@Module({
  imports: [PrismaModule, RagEmbeddingQueueModule, UploadModule],
  controllers: [RagController],
  providers: [RagService, RagSyncService, RagChunkService, RagEmbeddingService, RagQualityService],
  exports: [RagChunkService, RagEmbeddingService, RagQualityService],
})
export class RagModule {}
