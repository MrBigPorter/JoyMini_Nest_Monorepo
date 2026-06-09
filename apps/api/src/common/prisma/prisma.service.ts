// apps/api/src/prisma/prisma.service.ts
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** Extract a human-readable message from any thrown value. */
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// 事件最小结构
type LogEvent = { message: string };
type QueryEvent = { duration: number; query: string; params?: string };

// Prisma v6 removed LogDefinition from the generated-client Prisma namespace —
// define it locally so the constructor log option stays type-safe.
type LogDefinition = {
  level: 'query' | 'info' | 'warn' | 'error';
  emit: 'stdout' | 'event';
};

// 固定包含 query，避免 $on 被推成 never
const LOG_CONFIG: LogDefinition[] = [
  { level: 'warn', emit: 'event' },
  { level: 'error', emit: 'event' },
  { level: 'query', emit: 'event' },
];

// 收窄签名（仅为类型提示）
type OnLogFn = (t: 'warn' | 'error', l: (e: LogEvent) => void) => void;
type OnQueryFn = (t: 'query', l: (e: QueryEvent) => void) => void;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly isDev = process.env.NODE_ENV !== 'production';
  private readonly slowMs = Number(
    process.env.PRISMA_SLOW_MS ?? (this.isDev ? 80 : 200),
  );

  constructor() {
    super({
      errorFormat: process.env.NODE_ENV !== 'production' ? 'pretty' : 'minimal',
      log: LOG_CONFIG,
    });

    // 关键：把 $on 绑定回当前实例，避免丢失 this
    const onLog = (this.$on as unknown as OnLogFn).bind(this);
    const onQuery = (this.$on as unknown as OnQueryFn).bind(this);

    onLog('warn', (e) => this.logger.warn(e.message));
    onLog('error', (e) => this.logger.error(e.message));

    onQuery('query', (e) => {
      if (!this.isDev) return; // 生产不输出
      const took = e.duration;
      const isSlow = took > this.slowMs;

      // 参数截断：UPDATE/INSERT 的 params 可能包含完整的 contentLocalized JSON（超长），
      // 截断到 200 字符以避免日志过长，同时保留有用信息（如 ID、状态值）
      const truncateParams = (params: string, maxLen = 200): string => {
        if (!params || params.length <= maxLen) return params;
        return params.slice(0, maxLen) + '...(truncated)';
      };

      if (isSlow) {
        // 慢查询：输出完整 SQL，但截断 params（性能排查只需看 SQL 结构，不需要看全部数据）
        this.logger.log(
          `🐢 SLOW ${took}ms ${e.query}${e.params ? ` | params=${truncateParams(e.params)}` : ''}`,
        );
      } else {
        // 快速查询：仅输出摘要（操作为主+表名），大幅减少日志量
        // 从 SQL 中提取操作类型和数据表
        const q = e.query.trim();
        const op = q.split(/\s+/)[0]?.toUpperCase() || 'SQL';
        // 提取表名（SELECT/FROM/UPDATE/INSERT INTO/DELETE FROM 后的第一个标识符）
        let table = '';
        if (op === 'SELECT' || op === 'DELETE') {
          const fromIdx = q.toUpperCase().indexOf('FROM');
          if (fromIdx >= 0) {
            const afterFrom = q.slice(fromIdx + 4).trim();
            table = afterFrom.split(/\s+/)[0]?.replace(/"public"\./g, '') || '';
          }
        } else if (op === 'UPDATE') {
          const afterOp = q.slice(6).trim();
          table = afterOp.split(/\s+/)[0]?.replace(/"public"\./g, '') || '';
        } else if (op === 'INSERT') {
          const intoIdx = q.toUpperCase().indexOf('INTO');
          if (intoIdx >= 0) {
            const afterInto = q.slice(intoIdx + 4).trim();
            table = afterInto.split(/\s+/)[0]?.replace(/"public"\./g, '') || '';
          }
        }
        this.logger.log(
          `SQL ${took}ms [${op}] "${table}"${e.params ? ` | ${truncateParams(e.params)}` : ''}`,
        );
      }
    });
  }

  async onModuleInit() {
    for (let i = 1; i <= 8; i++) {
      try {
        await this.$connect();
        this.logger.log('Prisma connected');
        return;
      } catch (err: unknown) {
        const backoff = Math.min(1000 * 2 ** (i - 1), 10_000);
        this.logger.warn(
          `Prisma connect failed #${i}: ${errMsg(err)}. Retry in ${backoff}ms`,
        );
        await sleep(backoff);
      }
    }
    this.logger.error(
      'Prisma failed to connect after 8 retries — starting without DB',
    );
  }

  async onModuleDestroy() {
    try {
      await this.$disconnect();
    } catch (e: unknown) {
      this.logger.error(`Prisma disconnect error: ${errMsg(e)}`);
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (e: unknown) {
      this.logger.warn(`DB ping failed: ${errMsg(e)}`);
      return false;
    }
  }
}
