import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UploadRagDocDto {
  @ApiPropertyOptional({
    description: 'Override domain, e.g. order, product, wallet',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  domain?: string;

  @ApiPropertyOptional({
    description: 'Override locale, e.g. en, zh (default: en)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  @ApiPropertyOptional({
    description: 'Comma-separated keywords, e.g. refund,return,shipping',
  })
  @IsOptional()
  @IsString()
  keywords?: string;

  @ApiPropertyOptional({
    description: 'Content type override (default: policy)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  contentType?: string;

  @ApiPropertyOptional({
    description: 'Priority: P0 (urgent), P1 (high), P2 (normal)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  priority?: string;
}
