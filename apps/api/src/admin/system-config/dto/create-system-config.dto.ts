import { IsString, Length } from 'class-validator';

export class CreateSystemConfigDto {
  @IsString()
  @Length(1, 100)
  key!: string;

  @IsString()
  @Length(1, 255)
  value!: string;
}
