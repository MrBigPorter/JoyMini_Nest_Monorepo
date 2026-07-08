import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { RagController } from './rag.controller';
import { RagService } from './rag.service';
import { RagSyncService } from './rag-sync.service';
import { RagChunkService } from './rag-chunk.service';
import { RagEmbeddingService } from './rag-embedding.service';
import { RagEmbeddingQueueModule } from './rag-embedding-queue.module';

@Module({
  imports: [PrismaModule, RagEmbeddingQueueModule],
  controllers: [RagController],
  providers: [RagService, RagSyncService, RagChunkService, RagEmbeddingService],
  exports: [RagChunkService, RagEmbeddingService],
})
export class RagModule {}
