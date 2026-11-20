import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSecurityEventDto {
  @IsOptional()
  @IsIn(['NEW', 'CONFIRMED', 'FALSE_POSITIVE', 'BLOCKED'])
  status?: 'NEW' | 'CONFIRMED' | 'FALSE_POSITIVE' | 'BLOCKED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
