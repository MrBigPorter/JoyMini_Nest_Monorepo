import { Module } from '@nestjs/common';
import { CallGateway } from './call.gateway';
import { ChatModule } from '@api/common/chat/chat.module';

@Module({
  imports: [ChatModule],
  providers: [CallGateway],
})
export class CallModule {}
