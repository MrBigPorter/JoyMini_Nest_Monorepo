import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ChatService } from '@api/common/chat/chat.service';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { ApiBearerAuth, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { CurrentUserId } from '@api/common/decorators/user.decorator';
import { CreateDirectChatDto } from '@api/common/chat/dto/create-direct-chat.dto';
import { JoinBusinessChatDto } from '@api/common/chat/dto/join-business-chat.dto';
import { SearchUserDto } from '@api/common/chat/dto/search-user.dto';
import { plainToInstance } from 'class-transformer';
import { UserSimpleResponseDto } from '@api/common/chat/dto/user-simple.response.dto';
import { GetMessagesDto } from '@api/common/chat/dto/get-messages.dto';
import { ConversationDetailResponseDto } from '@api/common/chat/dto/conversation.response.dto';
import {
  MessageListResponseDto,
  MessageResponseDto,
} from '@api/common/chat/dto/message.response.dto';
import { CreateMessageDto } from '@api/common/chat/dto/create-message.dto';
import { MarkAsReadDto } from '@api/common/chat/dto/mark-as-read.dto';
import { MarkAsReadResponseDto } from '@api/common/chat/dto/mark-as-read.response.dto';
import { GetUploadTokenDto } from '@api/common/chat/dto/get-upload-token.dto';
import { UploadService } from '@api/common/upload/upload.service';
import { UploadTokenResponseDto } from '@api/common/chat/dto/upload-token-response.dto';
import { RecallMessageDto } from '@api/common/chat/dto/recall-message.dto';
import { RecallMessageResponseDto } from '@api/common/chat/dto/recall-message-response.dto';
import { DeleteMessageResponseDto } from '@api/common/chat/dto/delete-message.response.dto';
import { DeleteMessageDto } from '@api/common/chat/dto/delete-message.dto';
import {
  CreateGroupDto,
  GroupCreatedResponseDto,
} from '@api/common/chat/dto/group-chat.dto';
import { InviteToGroupDto } from '@api/common/chat/dto/invite-to-group.dto';
import { LeaveGroupDto } from '@api/common/chat/dto/leave-group.dto';
import { InviteToGroupResponseDto } from '@api/common/chat/dto/invite-to-group.response.dto';
import { LeaveGroupResponseDto } from '@api/common/chat/dto/leave-group.response.dto';
import { ForwardMessageDto } from '@api/common/chat/dto/forward-message.dto';
import { IceServerDto } from '@api/common/chat/dto/get-ice-servers.dto';
import {
  ClearHistoryDto,
  ClearHistoryResponseDto,
  SetMuteDto,
  SetMuteResponseDto,
  SetPinDto,
  SetPinResponseDto,
} from '@api/common/chat/dto/chat-settings.dto';

@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    // Inject UploadService for generating upload credentials
    private readonly uploadService: UploadService,
  ) {}

  /**
   * Get conversation list
   * @param page
   * @param userId
   */
  @Get('/list')
  async getConversationList(
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @CurrentUserId() userId: string,
  ) {
    return this.chatService.getConversationList(userId, page);
  }

  /**
   * Get chat history (messages)
   * @param query
   * @param userId
   */
  @Get('messages')
  @ApiResponse({ type: MessageListResponseDto })
  async getChatHistory(
    @Query() query: GetMessagesDto,
    @CurrentUserId() userId: string,
  ) {
    return this.chatService.getMessages(userId, query);
  }

  /**
   * Send a message
   * @param userId
   * @param dto
   */
  @Post('message')
  @HttpCode(HttpStatus.CREATED)
  @ApiResponse({ type: MessageResponseDto })
  async sendMessage(
    @CurrentUserId() userId: string,
    @Body() dto: CreateMessageDto,
  ) {
    // Call Service to handle business logic
    const msg = await this.chatService.sendMessage(userId, dto);

    // Format returned result
    return plainToInstance(MessageResponseDto, msg);
  }

  /**
   * Recall a message
   * @param dto
   * @param userId
   */
  @Post('message/recall')
  @HttpCode(HttpStatus.OK)
  async recall(@Body() dto: RecallMessageDto, @CurrentUserId() userId: string) {
    const result = await this.chatService.recallMessage(userId, dto.messageId);
    return plainToInstance(RecallMessageResponseDto, result);
  }

  /**
   * Delete a message
   * @param userId
   * @param dto
   */
  @Delete('message/delete')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({ type: DeleteMessageResponseDto })
  async recallMessage(
    @CurrentUserId() userId: string,
    @Body() dto: DeleteMessageDto,
  ) {
    const result = await this.chatService.deleteMessage(userId, dto);
    return plainToInstance(DeleteMessageResponseDto, result);
  }

  /**
   * Forward a message to multiple conversations
   * @param userId
   * @param dto
   */
  @Post('message/forward')
  @ApiResponse({ status: 201, description: 'Message forwarded successfully' })
  async forwardMessage(
    @CurrentUserId() userId: string,
    @Body() dto: ForwardMessageDto,
  ) {
    return this.chatService.forwardMessage(userId, dto);
  }

  /**
   * Mark messages as read
   * @param userId
   * @param dto
   */
  @Post('message/mark-as-read')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({ type: MarkAsReadResponseDto })
  async markAsRead(
    @CurrentUserId() userId: string,
    @Body() dto: MarkAsReadDto,
  ) {
    return this.chatService.markAsRead(userId, dto);
  }

  /**
   * Ensure a conversation with a business entity exists (e.g., merchant customer service), create if not
   * @param query
   * @param userId
   */
  @Get('business')
  async getBusinessChat(
    @Query() query: JoinBusinessChatDto,
    @CurrentUserId() userId: string,
  ) {
    const member = await this.chatService.addMemberToBusinessGroup(
      query.businessId,
      userId,
    );
    return { conversationId: member.conversationId };
  }

  /**
   * Ensure a direct chat (private message) with a specific user exists, create if not
   * @param dto
   * @param userId Current User ID
   */
  @Post('direct')
  @HttpCode(HttpStatus.OK)
  async getDirectChat(
    @Body() dto: CreateDirectChatDto,
    @CurrentUserId() userId: string,
  ) {
    const conv = await this.chatService.ensureDirectConversation(
      userId,
      dto.targetUserId,
    );
    return { conversationId: conv.id };
  }

  /**
   * Create a group chat conversation
   * @param userId Current User ID
   * @param dto
   */
  @Post('create-group')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({ type: GroupCreatedResponseDto })
  async createGroup(
    @CurrentUserId() userId: string,
    @Body() dto: CreateGroupDto,
  ) {
    const conv = await this.chatService.createGroupChat(userId, dto);
    return plainToInstance(GroupCreatedResponseDto, conv);
  }

  /**
   * Get conversation details
   * @param id
   * @param userId
   */
  @Get('detail/:id')
  @ApiResponse({ type: ConversationDetailResponseDto })
  getDetail(@Param('id') id: string, @CurrentUserId() userId: string) {
    const data = this.chatService.getConversationDetail(id, userId);
    return plainToInstance(ConversationDetailResponseDto, data);
  }

  /**
   * Search for users
   * @param dto
   * @param userId
   */
  @Get('users/search')
  @ApiResponse({ type: [UserSimpleResponseDto] })
  async searchUsers(
    @Query() dto: SearchUserDto,
    @CurrentUserId() userId: string,
  ) {
    const data = await this.chatService.searchUsers(userId, dto);
    return plainToInstance(UserSimpleResponseDto, data);
  }

  /**
   * Get upload token and URL for files
   * @param userId
   * @param body
   */
  @Post('upload-token')
  @ApiOkResponse({
    type: UploadTokenResponseDto,
  })
  async getUploadToken(
    @CurrentUserId() userId: string, // User ID parsed from Token
    @Body() body: GetUploadTokenDto,
  ) {
    // Call the designated UploadService
    // module set to 'chat', storing files at uploads/chat/user_id/xxx.jpg
    return this.uploadService.generatePresignedUrl(
      userId,
      body.fileName,
      body.fileType,
      'chat',
    );
  }

  /**
   * Invite users to join group chat
   * @param userId Current User ID
   * @param dto
   */
  @Post('group/invite')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({ type: InviteToGroupResponseDto })
  async inviteToGroup(
    @CurrentUserId() userId: string,
    @Body() dto: InviteToGroupDto,
  ) {
    return this.chatService.inviteToGroup(userId, dto);
  }

  /**
   * Leave group chat
   * @param userId Current User ID
   * @param dto
   */
  @Post('group/leave')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({ type: LeaveGroupResponseDto })
  async leaveGroup(
    @CurrentUserId() userId: string,
    @Body() dto: LeaveGroupDto,
  ) {
    return this.chatService.leaveGroup(userId, dto.groupId);
  }

  /**
   * Get ICE servers for WebRTC (for voice/video calls)
   * @param userId Current User ID
   */
  @Get('ice-servers')
  @ApiResponse({ status: 200, type: [IceServerDto] })
  getIceServers(@CurrentUserId() userId: string) {
    return this.chatService.getIceServers(userId);
  }

  @Post('settings/mute')
  @ApiOkResponse({ type: SetMuteResponseDto })
  async setMute(@CurrentUserId() userId: string, @Body() dto: SetMuteDto) {
    return this.chatService.setMute(userId, dto.conversationId, dto.isMuted);
  }

  @Post('settings/pin')
  @ApiOkResponse({ type: SetPinResponseDto })
  async setPin(@CurrentUserId() userId: string, @Body() dto: SetPinDto) {
    return this.chatService.setPin(userId, dto.conversationId, dto.isPinned);
  }

  @Post('settings/clear-history')
  @ApiOkResponse({ type: ClearHistoryResponseDto })
  async clearHistory(
    @CurrentUserId() userId: string,
    @Body() dto: ClearHistoryDto,
  ) {
    return this.chatService.clearHistory(userId, dto.conversationId);
  }
}
