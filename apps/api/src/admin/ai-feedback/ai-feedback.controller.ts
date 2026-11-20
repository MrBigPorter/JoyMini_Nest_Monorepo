import {
  Body,
  Controller,
  createParamDecorator,
  ExecutionContext,
  Get,
  HttpCode,
  Patch,
  Param,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ForbiddenException } from '@nestjs/common';
import { Role } from '@lucky/shared';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AiFeedbackService } from '@api/common/ai/ai-feedback.service';
import { CreateAiFeedbackDto } from './dto/create-ai-feedback.dto';
import { UpdateAiFeedbackDto } from './dto/update-ai-feedback.dto';
import { QueryAiFeedbackDto } from './dto/query-ai-feedback.dto';
import { CurrentRole } from '@api/common/decorators/user.decorator';
import { redactSensitiveFields } from '@api/common/utils/data-masking';

interface AdminRequest extends Request {
  user?: { userId?: string; username?: string; realName?: string };
}

const CurrentAdminId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<AdminRequest>();
    return req.user?.userId ?? 'admin';
  },
);

@ApiTags('Admin AI Feedback')
@Controller('admin/ai-feedback')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class AiFeedbackController {
  constructor(private readonly feedbackService: AiFeedbackService) {}

  /** 功能开关：默认关闭，验证通过后再置 true */
  private assertEnabled(): void {
    if (process.env.AI_FEEDBACK_UI_ENABLED !== 'true') {
      throw new ForbiddenException('AI feedback is disabled');
    }
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '提交一条显式回答反馈（正确 / 有误 + 类型）' })
  async create(
    @Body() dto: CreateAiFeedbackDto,
    @CurrentAdminId() adminId: string,
  ) {
    this.assertEnabled();
    return this.feedbackService.recordExplicit({
      conversationId: dto.conversationId,
      messageId: dto.messageId,
      userId: dto.userId,
      verdict: dto.verdict,
      errorType: dto.errorType,
      note: dto.note,
      adminId,
    });
  }

  @Get('summary')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: '反馈分诊汇总' })
  async summary(@Query() query: QueryAiFeedbackDto) {
    return this.feedbackService.summary(query);
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: '查询反馈列表（显式 + 隐式）' })
  async list(
    @Query() query: QueryAiFeedbackDto,
    @CurrentRole() role: string | null,
  ) {
    // 读取不依赖写开关：运营需要能查看历史反馈；关闭开关只关闭写入。
    const result = await this.feedbackService.list(query);
    return redactSensitiveFields(result, role, ['list.input', 'list.answer']);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: '反馈分诊：状态/结论/错误类型/备注' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAiFeedbackDto,
    @CurrentAdminId() adminId: string,
  ) {
    this.assertEnabled();
    return this.feedbackService.updateTriage(id, dto, adminId);
  }
}
