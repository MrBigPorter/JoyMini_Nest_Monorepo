import { IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryAdsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 20;

  /** 0=禁用 1=启用 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  status?: number;

  /** 1-首页顶 2-首页中 3-分类页 4-详情页 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  adPosition?: number;
}
