import { Module, Global } from '@nestjs/common';
import { AiService } from './ai.service';
import { GeminiProvider } from './providers/gemini.provider';
import { GroqProvider } from './providers/groq.provider';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { SystemConfigModule } from '@api/admin/system-config/system-config.module';

@Global()
@Module({
  imports: [SystemConfigModule],
  providers: [AiService, GeminiProvider, GroqProvider, DeepSeekProvider],
  exports: [AiService],
})
export class AiModule {}
