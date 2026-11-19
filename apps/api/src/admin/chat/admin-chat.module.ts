import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { UploadModule } from '@api/common/upload/upload.module';
import { EventsModule } from '@api/common/events/events.module';
import { ChatModule } from '@api/common/chat/chat.module';
import { AdminChatController } from './admin-chat.controller';
import { AdminChatService } from './admin-chat.service';
import { SupportSlaService } from './support-sla.service';
import { SupportQueueService } from './support-queue.service';

@Module({
  imports: [PrismaModule, UploadModule, EventsModule, ChatModule],
  controllers: [AdminChatController],
  providers: [AdminChatService, SupportSlaService, SupportQueueService],
})
export class AdminChatModule {}
