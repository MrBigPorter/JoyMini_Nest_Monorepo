import { IsString, IsOptional, MaxLength, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePromptVersionDto {
  @IsNotEmpty()
  @ApiProperty({
    description: 'Full prompt config as JSON object (AgentPromptConfig fields)',
    type: Object,
  })
  config!: Record<string, unknown>;

  @IsString()
  @IsOptional()
  @MaxLength(512)
  @ApiPropertyOptional({
    description: 'Change log / reason for this version',
    maxLength: 512,
  })
  changeLog?: string;
}
