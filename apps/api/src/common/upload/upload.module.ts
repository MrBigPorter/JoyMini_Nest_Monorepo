import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { UploadController } from '@api/common/upload/upload.controller';
import { UploadService } from '@api/common/upload/upload.service';
import { MEDIA_PROCESSOR_QUEUE } from '@api/common/media/media-processor.constants';
import { MediaProcessorModule } from '@api/common/media/media-processor.module';

@Module({
  imports: [
    ConfigModule,
    BullModule.registerQueue({
      name: MEDIA_PROCESSOR_QUEUE,
    }),
    forwardRef(() => MediaProcessorModule),
  ],
  controllers: [UploadController],
  providers: [UploadService],
  exports: [UploadService],
})
export class UploadModule {}
