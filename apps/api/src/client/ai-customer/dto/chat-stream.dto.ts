import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';

export class ChatStreamDto {
  @ApiProperty({
    description: '用户输入的消息',
    example: '帮我查看订单',
    type: String,
  })
  @IsString()
  message!: string;

  @ApiProperty({
    description: '会话 ID，可选',
    example: 'session-12345',
    type: String,
    required: false,
  })
  @IsOptional()
  @IsString()
  sessionId?: string;

  @ApiProperty({
    description: '指定已有 SUPPORT 对话的 ID（默认走 ai_chat 自动创建）',
    example: 'cuid_xxx',
    type: String,
    required: false,
  })
  @IsOptional()
  @IsString()
  conversationId?: string;

  @ApiProperty({
    description: '入口上下文，如 order_detail / deposit / profile',
    example: 'order_detail',
    type: String,
    required: false,
  })
  @IsOptional()
  @IsString()
  entryPoint?: string;

  @ApiProperty({
    description: '业务元数据，如 { orderId: "xxx" }',
    example: { orderId: '123' },
    type: Object,
    required: false,
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
