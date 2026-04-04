import { IsString } from 'class-validator';

export class UpdateSystemConfigDto {
  @IsString()
  value!: string;
}
