import { IsOptional, IsString, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginateDto } from '@api/common/dto/paginate.dto';
import { Transform } from 'class-transformer';

export class QueryRagDocDto extends PaginateDto {
  @IsString()
  @IsOptional()
  @ApiPropertyOptional({
    description: '按域名过滤',
    enum: [
      'order',
      'wallet',
      'coupon',
      'product',
      'user',
      'kyc',
      'lucky-draw',
      'common',
    ],
  })
  domain?: string;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional({ description: '搜索标题 + 内容' })
  search?: string;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional({
    description: '按优先级过滤',
    enum: ['P0', 'P1', 'P2'],
  })
  priority?: string;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @ApiPropertyOptional({ description: '是否启用', default: true })
  isActive?: boolean;
}
