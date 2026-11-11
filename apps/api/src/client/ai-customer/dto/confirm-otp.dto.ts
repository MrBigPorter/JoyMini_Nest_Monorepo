import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ConfirmOtpDto {
  @ApiProperty({
    description: '6-digit OTP code sent to the user phone for withdrawal',
    type: String,
  })
  @IsString()
  code!: string;
}
