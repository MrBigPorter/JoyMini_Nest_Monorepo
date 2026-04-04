import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { ClientSystemConfigController } from './system-config.controller';
import { ClientSystemConfigService } from './system-config.service';

@Module({
  imports: [PrismaModule],
  controllers: [ClientSystemConfigController],
  providers: [ClientSystemConfigService],
})
export class ClientSystemConfigModule {}
