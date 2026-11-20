import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@lucky/shared';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AiUsageService } from './ai-usage.service';
import { QueryAiUsageDto, QueryAiUsageUserDto } from './dto/query-ai-usage.dto';

@ApiTags('Admin - AI Usage')
@Controller('admin/ai-usage')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class AiUsageController {
  constructor(private readonly usage: AiUsageService) {}

  @Get('summary')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: 'AI 客服 token 用量汇总（UTC）' })
  async summary(@Query() query: QueryAiUsageDto) {
    return this.usage.summary(query.from, query.to);
  }

  @Get('users')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: '按用户查看 AI token 用量' })
  async users(@Query() query: QueryAiUsageDto) {
    return this.usage.users(query);
  }

  @Get('users/:userId')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: '单用户 AI token 用量' })
  async userDetail(
    @Param('userId') userId: string,
    @Query() query: QueryAiUsageUserDto,
  ) {
    return this.usage.userDetail(userId, query.from, query.to);
  }
}
