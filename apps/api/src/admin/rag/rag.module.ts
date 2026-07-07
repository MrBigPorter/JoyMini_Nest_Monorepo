import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { RagController } from './rag.controller';
import { RagService } from './rag.service';
import { RagSyncService } from './rag-sync.service';
import { RagChunkService } from './rag-chunk.service';
import { RagEmbeddingService } from './rag-embedding.service';

@Module({
  imports: [PrismaModule],
  controllers: [RagController],
  providers: [RagService, RagSyncService, RagChunkService, RagEmbeddingService],
  exports: [RagChunkService, RagEmbeddingService],
})
export class RagModule {}
