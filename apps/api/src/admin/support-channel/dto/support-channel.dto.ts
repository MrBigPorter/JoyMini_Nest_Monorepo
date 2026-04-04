import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class QuerySupportChannelsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  @IsBoolean()
  isActive?: boolean;
}

export class CreateSupportChannelDto {
  /** businessId，Flutter 通过 /chat/business?businessId=xxx 使用 */
  @IsString()
  @IsNotEmpty()
  id!: string;

  /** 渠道显示名（英文） */
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** 对外头像，写入 bot user.avatar */
  @IsOptional()
  @IsString()
  avatar?: string;
}

export class UpdateSupportChannelDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  avatar?: string;
}

export class ToggleSupportChannelDto {
  @IsBoolean()
  isActive!: boolean;
}
