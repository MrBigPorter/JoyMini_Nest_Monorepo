import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAdDto {
  @IsOptional()
  @IsString()
  title?: string;

  /** 1=图片 2=视频 */
  @IsInt()
  @Type(() => Number)
  fileType!: number;

  @IsOptional()
  @IsString()
  img?: string;

  @IsOptional()
  @IsString()
  videoUrl?: string;

  /** 1-首页顶 2-首页中 3-分类页 4-详情页 */
  @IsInt()
  @Type(() => Number)
  adPosition!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  jumpUrl?: string;

  @IsOptional()
  @IsString()
  relatedId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  jumpCate?: number;

  @IsOptional()
  @IsDateString()
  startTime?: string;

  @IsOptional()
  @IsDateString()
  endTime?: string;

  /** 0=禁用 1=启用 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  status?: number;
}

export class UpdateAdDto extends CreateAdDto {}
