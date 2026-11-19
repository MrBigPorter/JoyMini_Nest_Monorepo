import {
  Body,
  Controller,
  createParamDecorator,
  ExecutionContext,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@lucky/shared';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AiFeedbackService } from '@api/common/ai/ai-feedback.service';
import { CreateAiFeedbackDto } from './dto/create-ai-feedback.dto';
import { QueryAiFeedbackDto } from './dto/query-ai-feedback.dto';

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

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '提交一条显式回答反馈（正确 / 有误 + 类型）' })
  async create(
    @Body() dto: CreateAiFeedbackDto,
    @CurrentAdminId() adminId: string,
  ) {
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

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: '查询反馈列表（显式 + 隐式）' })
  async list(@Query() query: QueryAiFeedbackDto) {
    return this.feedbackService.list(query);
  }
}
