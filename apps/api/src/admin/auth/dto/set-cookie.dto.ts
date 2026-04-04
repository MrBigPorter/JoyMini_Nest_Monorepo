import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class SetCookieDto {
  @ApiProperty({
    description: 'Admin JWT access token to set as HTTP-only cookie',
    type: String,
  })
  @IsNotEmpty()
  @IsString()
  token!: string;
}
