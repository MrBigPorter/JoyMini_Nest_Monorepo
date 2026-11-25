import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
} from 'class-validator';

export class BatchExcludeDto {
  /** 一次最多 50 条，与质量待办单页大小对齐。 */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  ids!: string[];
}
