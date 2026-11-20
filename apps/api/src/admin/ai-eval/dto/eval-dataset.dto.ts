import { Type } from 'class-transformer';
import {
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class CreateEvalDatasetDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class EvalCaseDto {
  @IsString()
  question!: string;

  @IsString()
  answer!: string;

  @IsOptional()
  expect?: Record<string, any>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class AddEvalCasesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EvalCaseDto)
  cases!: EvalCaseDto[];
}
