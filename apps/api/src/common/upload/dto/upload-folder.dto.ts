import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UploadFolderDto {
  @ApiPropertyOptional({
    description: 'Upload folder',
    enum: [
      'kyc',
      'general',
      'avatar',
      'document',
      'other',
      'images',
      'videos',
      'treasure',
    ],
  })
  @IsOptional()
  @IsEnum(['kyc', 'general', 'avatar', 'document', 'other'])
  folder?:
    | 'kyc'
    | 'general'
    | 'avatar'
    | 'images'
    | 'videos'
    | 'document'
    | 'other'
    | 'treasure';

  @ApiPropertyOptional({
    description: 'Article ID for media processing (optional, blog only)',
  })
  @IsOptional()
  @IsString()
  articleId?: string;
}
