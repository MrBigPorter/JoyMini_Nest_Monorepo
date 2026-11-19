import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class TaskExpectationDto {
  @ApiPropertyOptional({ type: [String], description: '回答必须提到的关键信息' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mustMention?: string[];

  @ApiPropertyOptional({ description: '期望的确认动作，如 claim_coupon' })
  @IsOptional()
  @IsString()
  confirmAction?: string;

  @ApiPropertyOptional({ description: '是否禁止直接执行写操作' })
  @IsOptional()
  @IsBoolean()
  forbidExecution?: boolean;

  @ApiPropertyOptional({ description: '期望意图（仅作 judge 上下文）' })
  @IsOptional()
  @IsString()
  intent?: string;
}

export class JudgeTaskDto {
  @ApiProperty({ description: '用户问题' })
  @IsString()
  question!: string;

  @ApiProperty({ description: 'AI 回答' })
  @IsString()
  answer!: string;

  @ApiProperty({ type: TaskExpectationDto })
  @IsObject()
  expectTask!: TaskExpectationDto;

  @ApiPropertyOptional({ description: '写操作场景的确认卡片' })
  @IsOptional()
  @IsObject()
  pendingConfirm?: Record<string, any> | null;
}
