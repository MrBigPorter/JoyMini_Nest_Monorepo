import { IsString, IsNotEmpty } from 'class-validator';

export class TestIntentClassificationDto {
  @IsString()
  @IsNotEmpty()
  input!: string;
}
