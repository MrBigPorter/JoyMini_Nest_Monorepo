import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { SupportChannelController } from './support-channel.controller';
import { SupportChannelService } from './support-channel.service';

@Module({
  imports: [PrismaModule],
  controllers: [SupportChannelController],
  providers: [SupportChannelService],
})
export class SupportChannelModule {}
