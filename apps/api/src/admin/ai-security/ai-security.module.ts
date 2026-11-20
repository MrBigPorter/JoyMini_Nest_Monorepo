import { Module } from '@nestjs/common';
import { AiSecurityController } from './ai-security.controller';
import { AiSecurityService } from './ai-security.service';

@Module({
  controllers: [AiSecurityController],
  providers: [AiSecurityService],
})
export class AiSecurityAdminModule {}
