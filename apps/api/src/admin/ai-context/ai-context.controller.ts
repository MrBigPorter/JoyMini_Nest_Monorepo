import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@lucky/shared';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AiConversationDebugService } from '@api/client/ai-customer/debug/ai-conversation-debug.service';

@ApiTags('Admin - AI Context Debug')
@Controller('admin/ai-context')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class AiContextController {
  constructor(private readonly debug: AiConversationDebugService) {}

  @Get(':conversationId')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: '单会话上下文调试（flowState/contextState/messages）' })
  async inspect(@Param('conversationId') conversationId: string) {
    return this.debug.inspect(conversationId);
  }
}
