import { Module, Global } from '@nestjs/common';
import { AiService } from './ai.service';
import { GeminiProvider } from './providers/gemini.provider';
import { GroqProvider } from './providers/groq.provider';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { OllamaProvider } from './providers/ollama.provider';
import { JinaProvider } from './providers/jina.provider';
// Lightweight Embeddings — 免费线上 bge-m3（目前不用，Jina + Infinity 已覆盖）
// import { LightweightEmbeddingsProvider } from './providers/lightweight-embeddings.provider';
// Infinity — 本地 bge-m3 embedding（与 Jina 共存：Infinity 做 embedding，Jina 做 reranker）
import { InfinityProvider } from './providers/infinity.provider';
import { AutoReplyService } from './auto-reply/auto-reply.service';
import { CommentClassifier } from './auto-reply/comment-classifier';
import { ContextEnricher } from './auto-reply/context-enricher';
import { ReplyValidator } from './auto-reply/reply-validator';
import { AiMemoryService } from './ai-memory.service';
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
    InfinityProvider,
    // LightweightEmbeddingsProvider,  // 暂时不用
    AutoReplyService,
    CommentClassifier,
    ContextEnricher,
    ReplyValidator,
    AiMemoryService,
  ],
  exports: [AiService, AiMemoryService],
})
export class AiModule {}
