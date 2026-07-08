import {
  IsArray,
  IsString,
  IsOptional,
  IsIn,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';

export class UpdateIntentExamplesDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  sentences!: string[];

  @IsOptional()
  @IsString()
  @IsIn(['append', 'replace'])
  mode?: 'append' | 'replace';
}
