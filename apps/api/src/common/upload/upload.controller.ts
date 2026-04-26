import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiConsumes,
} from '@nestjs/swagger';
import {
  BadRequestException,
  Body,
  Controller,
  FileTypeValidator,
  ParseFilePipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { UploadService } from '@api/common/upload/upload.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadFolderDto } from '@api/common/upload/dto/upload-folder.dto';

/**
 * File size limits (in bytes) per target folder.
 * Multer `limits.fileSize` in FileInterceptor sets the hard cap (200MB max).
 * Module-specific validation in method body gives clear error messages.
 */
const FILE_SIZE_LIMITS: Record<string, number> = {
  images: 20 * 1024 * 1024,       // 20MB for blog images
  videos: 200 * 1024 * 1024,      // 200MB for blog videos
  treasures: 5 * 1024 * 1024,     // 5MB default (existing behavior)
  'chat/images': 10 * 1024 * 1024, // 10MB for chat images
};

// Hard cap for Multer (prevents Node heap exhaustion on very large files)
const MULTER_MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB

@ApiTags('Upload')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('image')
  @ApiOperation({ summary: 'upload image/video (Cloudflare R2)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MULTER_MAX_FILE_SIZE } }),
  )
  async uploadMedia(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          // File type validation only; size is checked manually below
          new FileTypeValidator({
            fileType: /(jpg|jpeg|png|gif|webp|mp4|avi|mov|mkv|webm)$/i,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body() dto: UploadFolderDto,
  ) {
    // Determine target folder based on mime type
    const isVideo = file.mimetype.startsWith('video/');
    const target = dto.folder ?? (isVideo ? 'videos' : 'images');

    // Module-specific file size validation
    const maxSize = FILE_SIZE_LIMITS[target] ?? FILE_SIZE_LIMITS.treasures;
    if (file.size > maxSize) {
      throw new BadRequestException(
        `File too large. Max size for "${target}" is ${maxSize / 1024 / 1024}MB. Received ${(file.size / 1024 / 1024).toFixed(1)}MB.`,
      );
    }

    return this.uploadService.uploadFile(file, target, dto.articleId);
  }
}
