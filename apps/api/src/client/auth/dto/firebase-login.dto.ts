import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';

export class FirebaseLoginDto {
  @ApiProperty({ description: 'Firebase ID Token' })
  @IsString()
  @IsNotEmpty()
  idToken!: string;

  @ApiPropertyOptional({
    description: 'invite code',
    minLength: 4,
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @Length(4, 20)
  inviteCode?: string;
}
