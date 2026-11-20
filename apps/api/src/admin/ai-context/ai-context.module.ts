import { Module } from '@nestjs/common';
import { AiContextController } from './ai-context.controller';

@Module({ controllers: [AiContextController] })
export class AiContextAdminModule {}
