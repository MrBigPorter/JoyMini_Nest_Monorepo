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
import {
  CreateExternalRunDto,
  IngestExternalResultsDto,
} from './dto/external-eval.dto';
import {
  CurrentRole,
  CurrentUserId,
} from '@api/common/decorators/user.decorator';
import { redactSensitiveFields } from '@api/common/utils/data-masking';

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

  /** 知识库回归状态：当前语料 vs 上次全量运行快照（实时计算）。 */
  @Get('kb-regression/status')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: '知识库回归状态（当前语料 vs 上次全量）' })
  async getKbRegressionStatus() {
    this.assertEnabled();
    return this.datasetService.getKbRegressionStatus();
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
  async getDataset(
    @Param('id') id: string,
    @CurrentRole() role: string | null,
  ) {
    const dataset = await this.datasetService.getDataset(id);
    return redactSensitiveFields(dataset, role, [
      'cases.question',
      'cases.answer',
      'cases.expected',
      'cases.expect',
    ]);
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
  async deleteCase(@Param('id') id: string, @Param('caseId') caseId: string) {
    this.assertEnabled();
    return this.datasetService.deleteCase(id, caseId);
  }

  @Post('datasets/:id/runs')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({
    summary: '启动一次批量评测（STORED 历史回答 / LIVE 实时跑 AI）',
  })
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

  /**
   * 外部（harness）运行：先建 RUNNING 头，再分段写结果。
   * 必须显式 `runs/external`，不能与 `runs/:id` 混用。
   */
  @Post('runs/external')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: '创建一次外部评测运行（harness 写入）' })
  async createExternalRun(
    @Body() dto: CreateExternalRunDto,
    @CurrentUserId() adminId: string,
  ) {
    this.assertEnabled();
    return this.datasetService.createExternalRun(dto, adminId);
  }

  @Post('runs/:id/external-results')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '写入外部评测结果并收尾' })
  async ingestExternalResults(
    @Param('id') id: string,
    @Body() dto: IngestExternalResultsDto,
  ) {
    this.assertEnabled();
    return this.datasetService.ingestExternalResults(id, dto);
  }

  @Post('runs/:id/promote')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '把一次运行登记为当前评测基线' })
  async promoteRun(@Param('id') id: string) {
    this.assertEnabled();
    return this.datasetService.promoteRun(id);
  }

  @Post('runs/:id/cancel')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '取消一次运行中的评测' })
  async cancelRun(@Param('id') id: string) {
    // 取消是安全阀：即使功能开关已关闭，也要能停掉已在运行、仍在烧 token 的 run。
    return this.datasetService.cancelRun(id);
  }

  /** 发布证据：逐项校验运行是否可证明「当前语料回归达标」。 */
  @Get('runs/:id/evidence')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: '发布证据（逐项校验）' })
  async getRunEvidence(@Param('id') id: string) {
    this.assertEnabled();
    return this.datasetService.getRunEvidence(id);
  }

  @Get('runs/:id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: '评测运行结果' })
  async getRun(@Param('id') id: string, @CurrentRole() role: string | null) {
    const run = await this.datasetService.getRun(id);
    return redactSensitiveFields(run, role, [
      'results.actualAnswer',
      'results.reason',
      'results.case.question',
      'results.case.answer',
      'results.case.expected',
      'results.case.expect',
    ]);
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
