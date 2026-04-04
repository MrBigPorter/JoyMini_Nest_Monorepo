import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { ChatController } from '@api/common/chat/chat.controller';
import { ChatService } from '@api/common/chat/chat.service';
import { EventsModule } from '@api/common/events/events.module';
import { UploadModule } from '@api/common/upload/upload.module';
import { AvatarModule } from '@api/common/avatar/avatar.module';
import { AVATAR_QUEUE_NAME } from '@api/common/avatar/avatar.processor';
import { BullModule } from '@nestjs/bullmq';
import { ContactController } from '@api/common/contact/contact.controller';
import { ContactService } from '@api/common/contact/contact.service';
import { NotificationModule } from '@api/client/notification/notification.module';
import { SocketListener } from '@api/common/events/listeners/socket.listener';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ChatGroupService } from '@api/common/chat/chat-group.service';
import { ChatGroupController } from '@api/common/chat/chat-group.controller';
import { ChatListener } from '@api/common/events/listeners/chat.listener';
import { CallModule } from '@api/common/events/call/call.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: AVATAR_QUEUE_NAME }),
    PrismaModule,
    EventsModule,
    UploadModule,
    AvatarModule,
    NotificationModule,
    EventEmitterModule.forRoot({ global: true }),
  ],
  controllers: [ChatController, ContactController, ChatGroupController],
  providers: [
    ChatService,
    ChatGroupService,
    ContactService,
    SocketListener,
    ChatListener,
  ],
  exports: [ChatService, ChatGroupService, ContactService],
})
export class ChatModule {}
