import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class TestChatDto {
  @ApiProperty({
    description: 'Message',
    type: String,
  })
  @IsString()
  message!: string;

  @ApiProperty({
    description: 'Enable debug mode — returns full LLM context',
    type: Boolean,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  debug?: boolean;

  @ApiProperty({
    description:
      'Session ID for conversation continuity. Same sessionId = continuous, different = isolated',
    type: String,
    required: false,
  })
  @IsOptional()
  @IsString()
  sessionId?: string;
}
