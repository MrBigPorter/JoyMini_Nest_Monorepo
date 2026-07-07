import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { AiPromptController } from './ai-prompt.controller';
import { AiPromptService } from './ai-prompt.service';

@Module({
  imports: [PrismaModule],
  controllers: [AiPromptController],
  providers: [AiPromptService],
  exports: [AiPromptService],
})
export class AiPromptModule {}
