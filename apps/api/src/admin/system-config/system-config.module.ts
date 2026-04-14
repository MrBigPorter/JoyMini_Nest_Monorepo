import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { SystemConfigController } from './system-config.controller';
import { PublicSystemConfigController } from './public-system-config.controller';
import { SystemConfigService } from './system-config.service';

@Module({
  imports: [PrismaModule],
  controllers: [SystemConfigController, PublicSystemConfigController],
  providers: [SystemConfigService],
  exports: [SystemConfigService],
})
export class SystemConfigModule {}
