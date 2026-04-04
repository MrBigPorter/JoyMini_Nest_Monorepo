import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListApplicationDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  pageSize?: number = 20;

  @ApiPropertyOptional({ enum: ['pending', 'approved', 'rejected', 'all'] })
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected', 'all'])
  status?: string = 'pending';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  username?: string;
}
