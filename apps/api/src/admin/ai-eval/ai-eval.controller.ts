import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@lucky/shared';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AiEvalJudgeService } from './ai-eval-judge.service';
import { JudgeTaskDto } from './dto/judge-task.dto';

@ApiTags('Admin AI Eval')
@Controller('admin/ai-eval')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class AiEvalController {
  constructor(private readonly judgeService: AiEvalJudgeService) {}

  /**
   * 仅评测环境启用：
   * - 显式 AI_EVAL_ENABLED=true，或
   * - NODE_ENV=development（本地评测）
   * 生产默认关闭，避免暴露判分入口。
   */
  private assertEnabled(): void {
    const enabled =
      process.env.AI_EVAL_ENABLED === 'true' ||
      process.env.NODE_ENV === 'development';
    if (!enabled) {
      throw new ForbiddenException('AI eval is disabled');
    }
  }

  @Post('judge')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '任务成功率判分（不同厂商 judge，仅评测环境）' })
  async judge(@Body() dto: JudgeTaskDto) {
    this.assertEnabled();
    return this.judgeService.judge({
      question: dto.question,
      answer: dto.answer,
      expectTask: dto.expectTask,
      pendingConfirm: dto.pendingConfirm,
    });
  }
}
