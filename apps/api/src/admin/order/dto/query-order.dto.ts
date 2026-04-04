import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ToNumber } from '@api/common/dto/transforms';

export class QueryOrderDto {
  @ApiPropertyOptional({ description: 'Current page number', default: 1 })
  @IsOptional()
  @ToNumber()
  @IsInt()
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 10 })
  @IsOptional()
  @ToNumber()
  @IsInt()
  pageSize?: number = 10;

  @ApiPropertyOptional({
    description: 'Search keyword: order number / user nickname / phone number',
  })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({
    description:
      'Order status filter: 1-Pending; 2-Processing; 3-Paid; 4-Cancelled; 5-Refunded; 6-Wait Group; 7-Ready to Ship; 8-Shipped; 9-Completed',
    example: 7,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([1, 2, 3, 4, 5, 6, 7, 8, 9])
  orderStatus?: number;
}
