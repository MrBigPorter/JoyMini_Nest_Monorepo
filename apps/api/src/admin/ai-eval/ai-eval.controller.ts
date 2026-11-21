import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import { AiEvalDatasetService } from './ai-eval-dataset.service';
import {
  AddEvalCasesDto,
  CreateEvalDatasetDto,
  StartEvalRunDto,
  UpdateEvalCaseDto,
} from './dto/eval-dataset.dto';
import { CurrentUserId } from '@api/common/decorators/user.decorator';

@ApiTags('Admin AI Eval')
@Controller('admin/ai-eval')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class AiEvalController {
  constructor(
    private readonly judgeService: AiEvalJudgeService,
    private readonly datasetService: AiEvalDatasetService,
  ) {}

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

  @Get('datasets')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: '评测集列表' })
  async listDatasets() {
    return this.datasetService.listDatasets();
  }

  @Post('datasets')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: '创建评测集' })
  async createDataset(
    @Body() dto: CreateEvalDatasetDto,
    @CurrentUserId() adminId: string,
  ) {
    this.assertEnabled();
    return this.datasetService.createDataset({ ...dto, createdBy: adminId });
  }

  @Get('datasets/:id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: '评测集详情' })
  async getDataset(@Param('id') id: string) {
    return this.datasetService.getDataset(id);
  }

  @Post('datasets/:id/cases')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: '批量添加评测用例' })
  async addCases(@Param('id') id: string, @Body() dto: AddEvalCasesDto) {
    this.assertEnabled();
    return this.datasetService.addCases(id, dto);
  }

  @Patch('datasets/:id/cases/:caseId')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: '编辑评测用例（期望答案/要点等）' })
  async updateCase(
    @Param('id') id: string,
    @Param('caseId') caseId: string,
    @Body() dto: UpdateEvalCaseDto,
  ) {
    this.assertEnabled();
    return this.datasetService.updateCase(id, caseId, dto);
  }

  @Delete('datasets/:id/cases/:caseId')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: '删除评测用例' })
  async deleteCase(
    @Param('id') id: string,
    @Param('caseId') caseId: string,
  ) {
    this.assertEnabled();
    return this.datasetService.deleteCase(id, caseId);
  }

  @Post('datasets/:id/runs')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: '启动一次批量评测（STORED 历史回答 / LIVE 实时跑 AI）' })
  async startRun(
    @Param('id') id: string,
    @CurrentUserId() adminId: string,
    @Body() dto: StartEvalRunDto = {},
  ) {
    this.assertEnabled();
    return this.datasetService.startRun(id, adminId, {
      mode: dto.mode,
      baselineRunId: dto.baselineRunId,
    });
  }

  @Get('runs/:id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: '评测运行结果' })
  async getRun(@Param('id') id: string) {
    return this.datasetService.getRun(id);
  }

  @Post('judge')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
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
