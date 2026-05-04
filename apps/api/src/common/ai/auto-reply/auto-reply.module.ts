import { Module, Global } from '@nestjs/common';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { AutoReplyService } from './auto-reply.service';
import { CommentClassifier } from './comment-classifier';
import { ContextEnricher } from './context-enricher';
import { ReplyValidator } from './reply-validator';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    AutoReplyService,
    CommentClassifier,
    ContextEnricher,
    ReplyValidator,
  ],
  exports: [AutoReplyService],
})
export class AutoReplyModule {}
