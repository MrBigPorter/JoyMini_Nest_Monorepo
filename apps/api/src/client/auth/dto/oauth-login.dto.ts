import { IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GoogleOauthLoginDto {
  @ApiProperty({ description: 'Google ID token' })
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  idToken?: string;

  @ApiPropertyOptional({
    description: 'Google Web SDK credential (same value as id token)',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  credential?: string;

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

export class GithubOauthLoginDto {
  @ApiProperty({ description: 'Github OAuth authorization code' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiPropertyOptional({
    description: 'Github access token (alternative to code)',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  accessToken?: string;

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

export class FacebookOauthLoginDto {
  @ApiProperty({ description: 'Facebook user access token' })
  @IsString()
  @IsNotEmpty()
  accessToken!: string;

  @ApiProperty({ description: 'Facebook user id' })
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  userId?: string;

  @ApiPropertyOptional({
    description: 'Facebook user id alias from some web SDK payloads',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  userID?: string;

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

export class AppleOauthLoginDto {
  @ApiProperty({ description: 'Apple identity token (JWT)' })
  @IsString()
  @IsNotEmpty()
  idToken!: string;

  @ApiPropertyOptional({ description: 'Apple authorization code' })
  @IsOptional()
  @IsString()
  code?: string;

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
