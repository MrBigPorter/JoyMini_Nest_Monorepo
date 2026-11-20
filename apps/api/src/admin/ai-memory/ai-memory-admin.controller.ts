import { Controller, Delete, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@lucky/shared';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUserId } from '@api/common/decorators/user.decorator';
import { AiMemoryAdminService } from './ai-memory-admin.service';

@ApiTags('Admin - AI Memory')
@Controller('admin/ai-memory')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class AiMemoryAdminController {
  constructor(private readonly memory: AiMemoryAdminService) {}

  @Get('users/:userId')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: '查看用户长期记忆与会话摘要' })
  async getUserMemories(@Param('userId') userId: string) {
    return this.memory.getUserMemories(userId);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: '软删除单条用户记忆' })
  async deleteMemory(
    @Param('id') id: string,
    @CurrentUserId() adminId: string,
  ) {
    return this.memory.deleteMemory(id, adminId);
  }

  @Delete('users/:userId')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: '删除用户全部长期记忆与会话摘要' })
  async deleteUserMemories(
    @Param('userId') userId: string,
    @CurrentUserId() adminId: string,
  ) {
    return this.memory.deleteUserMemories(userId, adminId);
  }
}
