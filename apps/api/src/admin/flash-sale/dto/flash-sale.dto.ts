import {
  IsDateString,
  IsDecimal,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateFlashSaleSessionDto {
  @IsString()
  title!: string;

  @IsDateString()
  startTime!: string;

  @IsDateString()
  endTime!: string;

  /** 1=上线 0=下线 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  status?: number;
}

export class UpdateFlashSaleSessionDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsDateString()
  startTime?: string;

  @IsOptional()
  @IsDateString()
  endTime?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  status?: number;
}

export class BindFlashSaleProductDto {
  @IsString()
  treasureId!: string;

  @IsDecimal({ decimal_digits: '0,2' })
  flashPrice!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  flashStock?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateFlashSaleProductDto {
  @IsOptional()
  @IsDecimal({ decimal_digits: '0,2' })
  flashPrice?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  flashStock?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
