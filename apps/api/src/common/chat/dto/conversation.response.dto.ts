import { ApiProperty } from '@nestjs/swagger';
import { ConversationType } from '@prisma/client';
import {
  ChatMemberRole,
  CHAT_MEMBER_ROLE_VALUES,
  CONVERSATION_TYPE_VALUES,
} from './chat-shared-enums';

// 1. Simple ID Response (for creation)
export class ConversationIdResponseDto {
  @ApiProperty({ description: 'Conversation ID' })
  conversationId!: string;
}

// 2. Conversation List Item (for the list/inbox page)
export class ConversationListResponseDto {
  @ApiProperty({ description: 'Conversation ID' })
  id!: string;

  @ApiProperty({
    enum: CONVERSATION_TYPE_VALUES,
    description: 'Type of conversation',
  })
  type!: ConversationType;

  @ApiProperty({ description: 'Display name (Group name or partner nickname)' })
  name!: string;

  @ApiProperty({ description: 'Display avatar URL', required: false })
  avatar?: string | null;

  @ApiProperty({ description: 'Content of the last message', required: false })
  lastMsgContent?: string | null;

  @ApiProperty({ description: 'Timestamp of the last message (milliseconds)' })
  lastMsgTime!: number;

  @ApiProperty({ description: 'Pinned status' })
  isPinned!: boolean;

  @ApiProperty({ description: 'Mute/DND status' })
  isMuted!: boolean;

  @ApiProperty({ description: 'Unread message count' })
  unreadCount!: number;

  @ApiProperty({ description: 'Sequence ID of the last message' })
  lastMsgSeqId!: number;

  constructor(partial: Partial<ConversationListResponseDto>) {
    Object.assign(this, partial);
  }
}

// 3. Member Information (Updated for v6.0)
export class ConversationMemberDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  nickname!: string;

  @ApiProperty()
  avatar!: string;

  @ApiProperty({ enum: CHAT_MEMBER_ROLE_VALUES, enumName: 'ChatMemberRole' })
  role!: string;

  //  [NEW] Individual mute status
  @ApiProperty({
    description: 'Timestamp when the mute expires (ms). null if not muted',
    required: false,
  })
  mutedUntil?: number | null;
}

// 4. Conversation Detail (Updated for v6.0)
export class ConversationDetailResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ required: false })
  avatar?: string;

  @ApiProperty({ enum: CONVERSATION_TYPE_VALUES })
  type!: ConversationType;

  @ApiProperty()
  ownerId!: string;

  @ApiProperty()
  memberCount!: number;

  //  [NEW] Group Settings
  @ApiProperty({ description: 'Group announcement', required: false })
  announcement?: string;

  @ApiProperty({ description: 'Global mute status for the group' })
  isMuteAll!: boolean;

  @ApiProperty({ description: 'Whether joining requires admin approval' })
  joinNeedApproval!: boolean;

  @ApiProperty({
    description: 'Current user application status for this group',
    enum: ['NONE', 'PENDING'],
    example: 'NONE',
    required: false, // 对成员来说可能是 undefined 或 NONE
  })
  applicationStatus?: 'NONE' | 'PENDING';

  // --- Synchronization & Self-healing START ---
  @ApiProperty({ description: 'Latest SeqId of the conversation' })
  lastMsgSeqId!: number;

  @ApiProperty({ description: 'Last read SeqId by the current user' })
  myLastReadSeqId!: number;

  @ApiProperty({ description: 'Calculated unread count' })
  unreadCount!: number;
  // --- Synchronization & Self-healing END ---

  @ApiProperty()
  isPinned!: boolean;

  @ApiProperty({ description: 'Personal mute/DND status for this user' })
  isMuted!: boolean;

  @ApiProperty({ type: [ConversationMemberDto] })
  members!: ConversationMemberDto[];
}
