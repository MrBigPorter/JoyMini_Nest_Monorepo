import { ApiProperty } from '@nestjs/swagger';
import { ToNumber } from '@api/common/dto/transforms';
import { IsInt, Max, Min } from 'class-validator';

export class GroupMembersDto {
  @ApiProperty({ description: 'page', example: 1, type: Number })
  @ToNumber()
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiProperty({ description: 'pageSize', example: 50, type: Number })
  @ToNumber()
  @Min(1)
  @Max(100)
  pageSize: number = 50;
}
