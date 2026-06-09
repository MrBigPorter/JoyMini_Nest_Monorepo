import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@api/common/prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  async health() {
    const db = await this.prisma.ping();
    const commitSha = this.configService.get<string>('APP_VERSION') || 'unknown';
    const envStatus = {
      nodeEnv: this.configService.get<string>('NODE_ENV'),
      dbReachable: !!db,
    };
    return {
      status: db ? 'ok' : 'degraded',
      commitSha,
      envStatus,
      checks: { db },
      timestamp: new Date().toISOString(),
    };
  }
}
