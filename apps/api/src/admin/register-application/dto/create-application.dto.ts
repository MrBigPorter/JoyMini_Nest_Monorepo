import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateApplicationDto {
  @ApiProperty({
    example: 'john_doe',
    description: 'Desired username (letters, numbers, underscore)',
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'Username can only contain letters, numbers and underscores',
  })
  username!: string;

  @ApiProperty({
    example: 'StrongPass123!',
    description: 'Password (min 8 chars, must contain letter+number)',
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Password must contain at least one letter and one number',
  })
  password!: string;

  @ApiProperty({ example: 'John Doe', description: 'Full real name' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  realName!: string;

  @ApiProperty({
    example: 'john@company.com',
    description: 'Contact email for approval notification',
  })
  @IsNotEmpty()
  @IsEmail({}, { message: 'Invalid email address' })
  @MaxLength(100)
  email!: string;

  @ApiPropertyOptional({
    example: 'I need access to manage orders.',
    description: 'Reason for applying',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  applyReason?: string;

  @ApiProperty({ description: 'Google reCAPTCHA v3 token' })
  @IsNotEmpty()
  @IsString()
  recaptchaToken!: string;
}
