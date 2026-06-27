import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class TestChatDto {
  @ApiProperty({
    description: 'Message',
    type: String,
  })
  @IsString()
  message!: string;
}
