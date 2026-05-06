import {
  Body,
  Controller,
  createParamDecorator,
  ExecutionContext,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AdminChatService } from './admin-chat.service';
import { AdminJwtAuthGuard } from '@api/admin/auth/admin-jwt-auth.guard';
import { RolesGuard } from '@api/admin/auth/roles.guard';
import { Roles } from '@api/admin/auth/roles.decorator';
import { Role } from '@lucky/shared';
import { QueryConversationsDto } from './dto/query-conversations.dto';
import {
  AdminReplyDto,
  AdminUploadTokenDto,
  CloseConversationDto,
  QueryMessagesDto,
} from './dto/admin-chat.dto';

interface AdminRequest extends Request {
  user?: { userId?: string; username?: string; realName?: string };
}

const CurrentAdminName = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<AdminRequest>();
    return req.user?.username ?? req.user?.realName ?? 'Admin';
  },
);

const CurrentAdminId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<AdminRequest>();
    return req.user?.userId ?? 'admin';
  },
);

@Controller('admin/chat')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class AdminChatController {
  constructor(private readonly service: AdminChatService) {}

  /** GET /v1/admin/chat/conversations — 客服会话列表 */
  @Get('conversations')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR, Role.VIEWER)
  getConversations(@Query() query: QueryConversationsDto) {
    return this.service.getConversations(query);
  }

  /** GET /v1/admin/chat/conversations/:id/messages — 消息历史 */
  @Get('conversations/:id/messages')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR, Role.VIEWER)
  getMessages(
    @Param('id') conversationId: string,
    @Query() query: QueryMessagesDto,
  ) {
    return this.service.getMessages(conversationId, query);
  }

  /** POST /v1/admin/chat/conversations/:id/reply — 客服回复 */
  @Post('conversations/:id/reply')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR)
  reply(
    @Param('id') conversationId: string,
    @Body() dto: AdminReplyDto,
    @CurrentAdminName() adminName: string,
    @CurrentAdminId() adminId: string,
  ) {
    return this.service.replyToConversation(
      conversationId,
      dto,
      adminName,
      adminId,
    );
  }

  /** POST /v1/admin/chat/messages/:id/force-recall — 强制撤回 */
  @Post('messages/:id/force-recall')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  forceRecall(@Param('id') messageId: string) {
    return this.service.forceRecallMessage(messageId);
  }

  /** PATCH /v1/admin/chat/conversations/:id/close — 关闭会话 */
  @Patch('conversations/:id/close')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR)
  closeConversation(
    @Param('id') conversationId: string,
    @Body() dto: CloseConversationDto,
    @CurrentAdminName() adminName: string,
  ) {
    return this.service.closeConversation(conversationId, dto, adminName);
  }

  /** POST /v1/admin/chat/upload-token — 获取媒体上传签名 URL */
  @Post('upload-token')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR)
  getUploadToken(
    @Body() dto: AdminUploadTokenDto,
    @CurrentAdminId() adminId: string,
  ) {
    return this.service.getUploadToken(adminId, dto);
  }
}
