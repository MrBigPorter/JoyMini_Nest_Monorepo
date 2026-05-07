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
import {
  GeneratePresignedUrlDto,
  ConfirmUploadDto,
} from '@api/common/upload/dto/presigned-url.dto';
import { CurrentUserId } from '@api/common/decorators/user.decorator';

/**
 * File size limits (in bytes) per target folder.
 * Multer `limits.fileSize` in FileInterceptor sets the hard cap (200MB max).
 * Module-specific validation in method body gives clear error messages.
 */
const FILE_SIZE_LIMITS: Record<string, number> = {
  images: 20 * 1024 * 1024, // 20MB for blog images
  videos: 250 * 1024 * 1024, // 250MB for blog videos
  treasures: 5 * 1024 * 1024, // 5MB default (existing behavior)
  'chat/images': 10 * 1024 * 1024, // 10MB for chat images
};

// Hard cap for Multer (prevents Node heap exhaustion on very large files)
const MULTER_MAX_FILE_SIZE = 250 * 1024 * 1024; // 250MB

@ApiTags('Upload')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  /**
   * Allowed file extensions (validated by originalname, not MIME type,
   * because some browsers/devices send `application/octet-stream` for videos).
   */
  private readonly ALLOWED_EXTENSIONS =
    /\.(jpg|jpeg|png|gif|webp|mp4|avi|mov|mkv|webm)$/i;
  private readonly VIDEO_EXTENSIONS = /\.(mp4|avi|mov|mkv|webm)$/i;

  @Post('image')
  @ApiOperation({ summary: 'upload image/video (Cloudflare R2)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MULTER_MAX_FILE_SIZE } }),
  )
  async uploadMedia(
    @UploadedFile(new ParseFilePipe({}))
    file: Express.Multer.File,
    @Body() dto: UploadFolderDto,
  ) {
    // 1. File extension validation (replaces FileTypeValidator; more reliable
    //    because it uses the original filename, not the browser's MIME sniffing)
    if (!this.ALLOWED_EXTENSIONS.test(file.originalname)) {
      throw new BadRequestException(
        `Invalid file type. Allowed: jpg, jpeg, png, gif, webp, mp4, avi, mov, mkv, webm`,
      );
    }

    // 2. Determine target folder: use explicit folder, or infer from file extension
    //    (fall back to extension check because `file.mimetype` can be
    //    `application/octet-stream` for videos from certain browsers/devices)
    const isVideo =
      file.mimetype.startsWith('video/') ||
      this.VIDEO_EXTENSIONS.test(file.originalname);
    const target = dto.folder ?? (isVideo ? 'videos' : 'images');

    // 3. Module-specific file size validation
    const maxSize = FILE_SIZE_LIMITS[target] ?? FILE_SIZE_LIMITS.treasures;
    if (file.size > maxSize) {
      throw new BadRequestException(
        `File too large. Max size for "${target}" is ${maxSize / 1024 / 1024}MB. Received ${(file.size / 1024 / 1024).toFixed(1)}MB.`,
      );
    }

    return this.uploadService.uploadFile(file, target, dto.articleId);
  }

  /**
   * Generate a presigned PUT URL so the browser can upload files directly to R2,
   * bypassing the NestJS server entirely. This avoids Multer memory bottlenecks
   * (OOM on large files) and enables native browser upload progress tracking.
   *
   * Flow:
   * 1. Client requests presigned URL → receives { url, key, cdnUrl }
   * 2. Client PUTs the file directly to the `url` (with native progress)
   * 3. Client POSTs `/admin/upload/confirm` with the `key` to trigger media processing
   */
  @Post('presigned-url')
  @ApiOperation({
    summary: 'Generate presigned URL for direct browser-to-R2 upload',
  })
  async generatePresignedUrl(
    @CurrentUserId() userId: string,
    @Body() dto: GeneratePresignedUrlDto,
  ) {
    return this.uploadService.generatePresignedUrl(
      userId,
      dto.fileName,
      dto.fileType,
      'blog',
    );
  }

  /**
   * Confirm a direct upload and trigger media processing (transcoding / compression).
   * This endpoint is lightweight (~50ms) — it does NOT wait for media processing.
   * The actual transcoding/compression runs in a BullMQ background job.
   */
  @Post('confirm')
  @ApiOperation({
    summary: 'Confirm direct upload and trigger media processing',
  })
  async confirmUpload(@Body() dto: ConfirmUploadDto) {
    return this.uploadService.confirmUpload(
      dto.key,
      dto.originalName,
      dto.articleId,
      dto.mimeType,
    );
  }
}
