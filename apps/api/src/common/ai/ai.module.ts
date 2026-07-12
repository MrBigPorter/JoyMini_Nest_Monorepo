import { Module, Global } from '@nestjs/common';
import { AiService } from './ai.service';
import { GeminiProvider } from './providers/gemini.provider';
import { GroqProvider } from './providers/groq.provider';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { OllamaProvider } from './providers/ollama.provider';
import { JinaProvider } from './providers/jina.provider';
// 如需切回本地 Infinity，取消下一行的注释并注释掉 JinaProvider
// import { InfinityProvider } from './providers/infinity.provider';
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
    OllamaProvider,
    JinaProvider,
    // InfinityProvider,  // 切回本地时取消注释，同时注释掉上面的 JinaProvider
    AutoReplyService,
    CommentClassifier,
    ContextEnricher,
    ReplyValidator,
  ],
  exports: [AiService],
})
export class AiModule {}
