import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ConfirmActionDto {
  @ApiProperty({
    description: 'Confirm token from the AI_CONFIRM card event',
    type: String,
  })
  @IsString()
  token!: string;

  /**
   * 待执行任务 id（卡片事件里的 requestId）。提现已确认、令牌已消费时，
   * 取消用它绑定到正确的待执行任务，避免任意令牌取消别人的提现。
   */
  @ApiPropertyOptional({
    description: 'Action request id from the AI_CONFIRM card event',
    type: String,
  })
  @IsOptional()
  @IsString()
  requestId?: string;
}
