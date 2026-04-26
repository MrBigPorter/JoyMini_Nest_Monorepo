import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { UploadModule } from '@api/common/upload/upload.module';
import { MediaProcessorService } from './media-processor.service';
import { MediaProcessor } from './media.processor';
import { MEDIA_PROCESSOR_QUEUE } from './media-processor.constants';

@Module({
  imports: [
    BullModule.registerQueue({
      name: MEDIA_PROCESSOR_QUEUE,
    }),
    PrismaModule,
    UploadModule,
  ],
  controllers: [],
  providers: [MediaProcessorService, MediaProcessor],
  exports: [BullModule, MediaProcessorService],
})
export class MediaProcessorModule {}
