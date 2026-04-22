import { Module } from '@nestjs/common';
import { TagController } from './tag.controller';
import { TagService } from './tag.service';
import { SystemConfigModule } from '@api/admin/system-config/system-config.module';
import { SystemConfigService } from '@api/admin/system-config/system-config.service';

@Module({
  imports: [SystemConfigModule],
  controllers: [TagController],
  providers: [TagService, SystemConfigService],
  exports: [TagService],
})
export class TagModule {}
