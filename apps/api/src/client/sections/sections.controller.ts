import { Controller, Get, HttpException, Query } from '@nestjs/common';
import { SectionsService } from '@api/client/sections/sections.service';

@Controller('home')
export class SectionsController {
  constructor(private readonly svc: SectionsService) {}

  @Get('sections')
  async sections(@Query('limit') limit?: string) {
    const n = parseInt(limit ?? '10', 10);
    // 捕获可能产生的锁繁忙异常
    try {
      return await this.svc.getHomeSections(isNaN(n) ? 10 : n);
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('Lock busy')) {
        // 这里可以根据业务决定是返回 429 还是返回一个过期的缓存/空列表
        throw new HttpException('System is busy, please try again later', 429);
      }
      throw error;
    }
  }
}
