import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ConversationType } from '@prisma/client';
import { CONVERSATION_TYPE_VALUES } from '@api/common/chat/dto/chat-shared-enums';

export class QueryConversationsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 20;

  /** 按会话类型筛选，默认只看 BUSINESS */
  @IsOptional()
  @IsIn(CONVERSATION_TYPE_VALUES as unknown as string[])
  type?: ConversationType;

  /** 关键词：会话名称 / 用户昵称 */
  @IsOptional()
  @IsString()
  keyword?: string;

  /**
   * 状态筛选：1=正常 2=归档/已关闭
   * 对应 Conversation.status
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  status?: number;
}
