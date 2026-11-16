import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** 回滚知识库文档到指定历史版本 */
export class RollbackVersionDto {
  @IsInt()
  @Min(1)
  @ApiProperty({
    description: '目标版本号（必须仍有 chunk 保留在库里）',
    example: 2,
  })
  toVersion!: number;
}
