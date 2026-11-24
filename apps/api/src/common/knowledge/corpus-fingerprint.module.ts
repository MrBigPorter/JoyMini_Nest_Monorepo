import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { CorpusFingerprintService } from './corpus-fingerprint.service';

/** 语料指纹被 RAG 管理端与 AI 评测共用，单独成模块避免互相依赖。 */
@Module({
  imports: [PrismaModule],
  providers: [CorpusFingerprintService],
  exports: [CorpusFingerprintService],
})
export class CorpusFingerprintModule {}
