import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class JoinBusinessChatDto {
  @ApiProperty({ description: '业务ID (如GroupId)', example: 'group_123' })
  @IsNotEmpty()
  @IsString()
  businessId!: string;

  /** 可选流量来源标记（如 simulation_support_v1），写入会话 aiMetadata。 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  trafficSource?: string;
}
