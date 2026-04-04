import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class AdminRefreshTokenDto {
  @ApiProperty({ description: 'admin refresh token' })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
