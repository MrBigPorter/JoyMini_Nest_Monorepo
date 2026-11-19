import {
  Controller,
  Get,
  Headers,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { renderMetrics } from './metrics';

@Controller('metrics')
export class MetricsController {
  /**
   * Prometheus 抓取端点（GET /api/v1/metrics）。
   * 如果设置了 METRICS_TOKEN，则要求 Authorization: Bearer <token>。
   * 用 @Res() 直接写文本，绕过全局 JSON 响应包装。
   */
  @Get()
  get(
    @Res() res: Response,
    @Headers('authorization') authorization?: string,
  ): void {
    const token = process.env.METRICS_TOKEN?.trim();
    if (token && authorization !== `Bearer ${token}`) {
      throw new UnauthorizedException('Invalid metrics token');
    }

    res.type('text/plain; version=0.0.4; charset=utf-8').send(renderMetrics());
  }
}
