import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ToDate, ToNumber } from '@api/common/dto/transforms';
import { Type } from 'class-transformer';

// 定义 bonusConfig 的结构验证
class BonusConfigDto {
  @ApiProperty({ description: 'Bonus item name', example: 'iPhone 15' })
  @IsString()
  bonusItemName!: string;

  @ApiPropertyOptional({ description: 'Bonus item image' })
  @IsOptional()
  @IsString()
  bonusItemImg?: string;

  @ApiProperty({ description: 'Number of winners per group', example: 1 })
  @IsInt()
  @Min(1)
  winnerCount!: number;

  @ApiPropertyOptional({ description: 'Allow robots', example: true })
  @IsOptional()
  allowRobot?: boolean;
}

export class CreateTreasureDto {
  // --- A. 基础信息 ---
  @ApiProperty({
    description: 'Treasure name (Product Name)',
    example: 'Lucky Limited Edition Badge',
  })
  @IsNotEmpty()
  @IsString()
  treasureName!: string;

  @ApiProperty({
    description: 'Cover image URL',
    example: 'https://oss.../badge.jpg',
  })
  @IsNotEmpty()
  @IsString()
  treasureCoverImg!: string;

  @ApiPropertyOptional({ description: 'Blurhash placeholder for cover image' })
  @IsOptional()
  @IsString()
  blurhash?: string;

  @ApiPropertyOptional({ description: 'Description / Details HTML' })
  @IsOptional()
  @IsString()
  desc?: string;

  @ApiPropertyOptional({ description: 'Rule content (deprecated)' })
  @IsOptional()
  @IsString()
  ruleContent?: string;

  @ApiProperty({ description: 'Category IDs', example: [1, 2] })
  @IsArray()
  @IsNotEmpty()
  @IsInt({ each: true })
  categoryIds!: number[];

  @ApiPropertyOptional({ description: 'Cost price (for internal use)' })
  @IsOptional()
  @ToNumber()
  @IsNumber()
  @Min(0)
  costAmount?: number;

  @ApiProperty({ description: 'Selling price (Unit Amount)', example: 50.0 })
  @IsNotEmpty()
  @ToNumber()
  @IsNumber()
  @Min(0.01)
  unitAmount!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  marketAmount?: number; // 划线价

  @IsOptional()
  @IsNumber()
  @Min(0)
  soloAmount?: number; // 单买价

  @IsOptional()
  @IsBoolean()
  enableRobot?: boolean; // 机器人开关

  @IsOptional()
  @ToNumber()
  @IsNumber()
  robotDelay?: number;

  @IsOptional()
  @ToNumber()
  @IsNumber()
  leaderBonusType?: number;

  @ApiProperty({
    description: 'Initial stock quantity when listed',
    example: 100,
  })
  @IsNotEmpty()
  @ToNumber()
  @IsInt()
  @Min(0)
  seqShelvesQuantity!: number;

  // --- C. 物流属性  ---
  @ApiProperty({
    description: 'Shipping Type: 1-Physical, 2-No Shipping',
    example: 1,
    default: 1,
  })
  @IsOptional() // 可选，默认为 1
  @IsInt()
  @IsEnum([1, 2, 3])
  shippingType?: number;

  @ApiPropertyOptional({ description: 'Weight in kg', example: 0.5 })
  @IsOptional()
  @ToNumber()
  @IsNumber()
  weight?: number;

  // --- D. 拼团配置 ---
  @ApiProperty({ description: 'Group size', example: 5, default: 5 })
  @IsOptional()
  @ToNumber()
  @IsInt()
  @Min(2)
  groupSize?: number;

  @ApiProperty({
    description: 'Group time limit in seconds',
    example: 86400,
    default: 86400,
  })
  @IsOptional()
  @ToNumber()
  @IsInt()
  @Min(60)
  groupTimeLimit?: number;

  // --- E. 销售时间 (Pre-sale) ---
  @ApiProperty({ description: 'Sales start time' })
  @IsNotEmpty()
  @ToDate()
  @IsDate()
  salesStartAt!: Date;

  @ApiProperty({ description: 'Sales end time' })
  @IsNotEmpty()
  @ToDate()
  @IsDate()
  salesEndAt!: Date;

  // --- E. 赠品配置 (JSON) ---
  @ApiPropertyOptional({ description: 'Bonus configuration JSON' })
  @IsOptional()
  @IsObject()
  @ValidateNested() // 如果想严格验证内部结构取消注释
  @Type(() => BonusConfigDto)
  bonusConfig?: BonusConfigDto;
}
