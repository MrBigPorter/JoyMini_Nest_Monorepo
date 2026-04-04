import { ApiProperty } from '@nestjs/swagger';

export class AdminTokenPairDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  refreshToken!: string;
}

export class AdminTokenResponseDto {
  @ApiProperty({ type: AdminTokenPairDto })
  tokens!: AdminTokenPairDto;
}
