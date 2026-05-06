import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdminLoginDto {
  @ApiProperty({ description: 'username', example: 'admin', type: String })
  @IsNotEmpty()
  @IsString()
  username!: string;

  @ApiProperty({ description: 'password', example: '123456', type: String })
  @IsNotEmpty()
  @IsString()
  password!: string;

  @ApiProperty({ description: 'reCAPTCHA token', required: false })
  @IsOptional()
  @IsString()
  recaptchaToken?: string;
}
