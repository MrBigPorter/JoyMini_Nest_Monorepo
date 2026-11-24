import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  health() {
    // 部署时由 Dockerfile.prod 注入 APP_VERSION（= 构建的 git sha）。
    // 本地/未注入时回退 GIT_SHA，再缺省为 unknown——证据链需要能区分
    // 「不知道跑的是哪个版本」和「跑的是某个具体 commit」。
    const commitSha =
      process.env.APP_VERSION || process.env.GIT_SHA || 'unknown';
    return { ok: true, commitSha };
  }

  @Get('dbcheck')
  // src/app.controller.ts
  async dbcheck() {
    const users = await this.prisma.user.count();
    const rows = await this.prisma.$queryRaw<
      { now: string }[]
    >`select now() as now`;
    const first = rows.length ? rows[0] : undefined;
    return { users, dbTime: first?.now ?? null };
  }
}
