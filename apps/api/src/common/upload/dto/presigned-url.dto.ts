import { IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GeneratePresignedUrlDto {
  @ApiProperty({ description: 'Original file name (e.g. video.mp4)' })
  @IsString()
  fileName!: string;

  @ApiProperty({ description: 'MIME type (e.g. video/mp4)' })
  @IsString()
  fileType!: string;
}

export class ConfirmUploadDto {
  @ApiProperty({
    description: 'R2 object key returned from presigned-url endpoint',
  })
  @IsString()
  key!: string;

  @ApiProperty({ description: 'Original file name' })
  @IsString()
  originalName!: string;

  @ApiPropertyOptional({
    description: 'Article ID for media processing (optional)',
  })
  @IsOptional()
  @IsString()
  articleId?: string;

  @ApiPropertyOptional({
    description: 'MIME type (used for isVideo detection fallback)',
  })
  @IsOptional()
  @IsString()
  mimeType?: string;

  @ApiPropertyOptional({
    description:
      'Optional media usage hint (blog): "cover" (coverImage) or "content" (rich-text). Used to route transcoding results to meta.video vs meta.contentVideo.',
  })
  @IsOptional()
  @IsString()
  mediaUsage?: string;
}
