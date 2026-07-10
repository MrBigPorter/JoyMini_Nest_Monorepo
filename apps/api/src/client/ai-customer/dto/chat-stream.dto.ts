import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

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
  @IsString()
  sessionId?: string;
}
