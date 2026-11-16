import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { KbVersionService } from '@api/client/ai-customer/knowledge/kb-version.service';

/**
 * 知识库旧版本清理任务
 *
 * 每天跑一次：把「切换后已稳定超过保留期」的旧版本 chunk 从 PG 与 Meili 清掉。
 *
 * 为什么不做分布式锁？
 *   清理是幂等的：删已经删掉的行返回 0，Meili 按同一过滤条件重复删也无副作用。
 *   两个实例同时跑只是多做一次无效工作，不会造成数据问题。
 */
@Injectable()
export class RagVersionPurgeTask {
  private readonly logger = new Logger(RagVersionPurgeTask.name);

  constructor(private readonly kbVersionService: KbVersionService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purge(): Promise<void> {
    try {
      const result = await this.kbVersionService.purgeStaleVersions();
      if (result.documents > 0) {
        this.logger.log(
          `Purged stale versions: ${result.documents} document(s), ` +
            `${result.chunks} chunk(s)`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Purge stale versions failed: ${message}`);
    }
  }
}
