import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Role } from '@lucky/shared';
import { AdminJwtAuthGuard } from '@api/admin/auth/admin-jwt-auth.guard';
import { RolesGuard } from '@api/admin/auth/roles.guard';
import { Roles } from '@api/admin/auth/roles.decorator';
import { CurrentUserId } from '@api/common/decorators/user.decorator';
import { KbKeywordAutoApplyService } from './kb-keyword-auto-apply.service';
import { KbCandidatesService } from './kb-candidates.service';
import {
  ApproveKbCandidateDto,
  BatchKbCandidatesDto,
  ListKbCandidatesDto,
  RejectKbCandidateDto,
  RetargetKbCandidateDto,
} from './dto/kb-candidate.dto';

/**
 * 候选审核台接口（M2b）。
 *
 * 所有「生效」动作都走应用服务：示例双写 config + 运行表，
 * 关键词走 M2a 的可逆路径，golden 只写 kb_synthetic_golden。
 */
@ApiTags('Admin KB Candidates')
@Controller('admin/kb-candidates')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class KbCandidatesController {
  constructor(
    private readonly candidatesService: KbCandidatesService,
    private readonly keywordAutoApply: KbKeywordAutoApplyService,
  ) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: 'List candidates with queue stats' })
  list(@Query() query: ListKbCandidatesDto) {
    return this.candidatesService.list(query);
  }

  @Get('runs/:documentId')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: 'Recent generation runs of a document' })
  runs(@Param('documentId') documentId: string) {
    return this.candidatesService.runs(documentId);
  }

  @Post('batch')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Batch approve/reject (same kind, max 50, confirm required)',
  })
  batch(@Body() dto: BatchKbCandidatesDto, @CurrentUserId() adminId: string) {
    return this.candidatesService.batch(dto, adminId);
  }

  @Post('documents/:documentId/regenerate')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Force a new candidate generation run' })
  regenerate(@Param('documentId') documentId: string) {
    return this.candidatesService.regenerate(documentId);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: 'Candidate detail with source document' })
  get(@Param('id') id: string) {
    return this.candidatesService.get(id);
  }

  @Post(':id/approve')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve and apply a candidate' })
  approve(
    @Param('id') id: string,
    @Body() dto: ApproveKbCandidateDto,
    @CurrentUserId() adminId: string,
  ) {
    return this.candidatesService.approve(id, dto, adminId);
  }

  @Post(':id/reject')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a candidate (reason required)' })
  reject(
    @Param('id') id: string,
    @Body() dto: RejectKbCandidateDto,
    @CurrentUserId() adminId: string,
  ) {
    return this.candidatesService.reject(id, dto.reason, adminId);
  }

  @Post(':id/retarget')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retarget an INTENT_EXAMPLE candidate' })
  retarget(@Param('id') id: string, @Body() dto: RetargetKbCandidateDto) {
    return this.candidatesService.retarget(id, dto);
  }

  @Post(':id/rollback-keyword')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Roll back one auto-applied keyword candidate',
    description:
      'Only removes the keyword added by this candidate; other manual/auto keywords stay untouched.',
  })
  @ApiParam({ name: 'id', description: 'Candidate ID' })
  async rollbackKeyword(
    @Param('id') id: string,
    @CurrentUserId() adminId: string,
  ): Promise<{ documentId: string; keywords: string[] }> {
    return this.keywordAutoApply.rollbackKeyword(id, adminId);
  }
}
