import { Module } from '@nestjs/common';
import { CategoryController } from './category.controller';
import { CategoryService } from './category.service';
import { SystemConfigModule } from '@api/admin/system-config/system-config.module';
import { SystemConfigService } from '@api/admin/system-config/system-config.service';

@Module({
  imports: [SystemConfigModule],
  controllers: [CategoryController],
  providers: [CategoryService, SystemConfigService],
  exports: [CategoryService],
})
export class CategoryModule {}
