import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ConfirmActionDto {
  @ApiProperty({
    description: 'Confirm token from the AI_CONFIRM card event',
    type: String,
  })
  @IsString()
  token!: string;
}
