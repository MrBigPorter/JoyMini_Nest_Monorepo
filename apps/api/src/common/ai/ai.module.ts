import { Module, Global } from '@nestjs/common';
import { AiService } from './ai.service';
import { GeminiProvider } from './providers/gemini.provider';
import { GroqProvider } from './providers/groq.provider';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { AutoReplyService } from './auto-reply/auto-reply.service';
import { CommentClassifier } from './auto-reply/comment-classifier';
import { ContextEnricher } from './auto-reply/context-enricher';
import { ReplyValidator } from './auto-reply/reply-validator';
import { SystemConfigModule } from '@api/admin/system-config/system-config.module';

@Global()
@Module({
  imports: [SystemConfigModule],
  providers: [
    AiService,
    GeminiProvider,
    GroqProvider,
    DeepSeekProvider,
    AutoReplyService,
    CommentClassifier,
    ContextEnricher,
    ReplyValidator,
  ],
  exports: [AiService],
})
export class AiModule {}
