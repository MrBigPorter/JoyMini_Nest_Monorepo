import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@lucky/shared';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

/**
 * AI Ops 功能开关的只读视图。
 *
 * 客户端不能直接读服务端 env；页面需要知道“功能是否启用”才能显示
 * 禁用态而不是渲染按钮后 403。写接口的 env gate 仍是最终边界。
 */
@ApiTags('Admin - AI Ops Features')
@Controller('admin/ai-ops')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class AiOpsFeaturesController {
  @Get('features')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR, Role.VIEWER)
  @ApiOperation({ summary: 'AI Ops 功能开关（只读）' })
  features() {
    return {
      feedbackUiEnabled: process.env.AI_FEEDBACK_UI_ENABLED === 'true',
      evalEnabled:
        process.env.AI_EVAL_ENABLED === 'true' ||
        process.env.NODE_ENV === 'development',
    };
  }
}
