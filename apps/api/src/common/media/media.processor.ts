import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { MediaProcessorService } from './media-processor.service';
import { UploadService } from '@api/common/upload/upload.service';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { MEDIA_PROCESSOR_QUEUE } from './media-processor.constants';

/** Max image file size to process (50MB) - larger files are skipped */
const MAX_IMAGE_PROCESS_SIZE = 50 * 1024 * 1024;
/** Max video file size to process (500MB) - larger files are skipped */
const MAX_VIDEO_PROCESS_SIZE = 500 * 1024 * 1024;

interface CompressImageJobData {
  articleId: string;
  imageKey: string;
  mimeType: string;
}

interface TranscodeVideoJobData {
  articleId: string;
  videoKey: string;
  mimeType: string;
}

@Processor(MEDIA_PROCESSOR_QUEUE, {
  concurrency: 2, // Allow 2 concurrent jobs
})
export class MediaProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaProcessor.name);

  constructor(
    private readonly mediaProcessorService: MediaProcessorService,
    private readonly uploadService: UploadService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.debug(`[Job Received] Name: ${job.name}, ID: ${job.id}`);

    switch (job.name) {
      case 'compress-image':
        return this.handleCompressImage(job);
      case 'transcode-video':
        return this.handleTranscodeVideo(job);
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  /**
   * Check file size via S3 HeadObject before downloading.
   * Returns true if the file is within acceptable size limits.
   */
  private async checkFileSize(
    key: string,
    maxSize: number,
    label: string,
  ): Promise<boolean> {
    try {
      const fileSize = await this.uploadService.getFileSize(key, 'blog');
      if (fileSize === 0) {
        this.logger.warn(`[${label}] File not found or inaccessible: ${key}`);
        return false;
      }
      if (fileSize > maxSize) {
        this.logger.warn(
          `[${label}] File too large (${(fileSize / 1024 / 1024).toFixed(1)}MB), max ${(maxSize / 1024 / 1024).toFixed(1)}MB. Skipping: ${key}`,
        );
        return false;
      }
      this.logger.debug(
        `[${label}] File size OK: ${(fileSize / 1024 / 1024).toFixed(1)}MB - ${key}`,
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `[${label}] Failed to check file size for ${key}: ${error}`,
      );
      // If we can't check size, still try processing (fail-safe)
      return true;
    }
  }

  /**
   * Handle image compression job
   */
  private async handleCompressImage(
    job: Job<CompressImageJobData>,
  ): Promise<void> {
    const { articleId, imageKey, mimeType } = job.data;
    this.logger.log(`Compressing image for article ${articleId}: ${imageKey}`);

    // Check file size before downloading
    const sizeOk = await this.checkFileSize(
      imageKey,
      MAX_IMAGE_PROCESS_SIZE,
      'compress-image',
    );
    if (!sizeOk) {
      this.logger.log(
        `Skipping image compression for article ${articleId} due to file size`,
      );
      return;
    }

    try {
      // Download original from R2
      const buffer = await this.uploadService.getFileBuffer(
        imageKey,
        'blog',
        articleId,
      );

      // Compress and generate variants
      const variants = await this.mediaProcessorService.compressImage(
        buffer,
        articleId,
        imageKey,
      );

      // Update article meta with image variants
      const existingArticle = await this.prisma.blogArticle.findUnique({
        where: { id: articleId },
        select: { meta: true },
      });
      const existingMeta = (existingArticle?.meta as Record<string, any>) || {};
      await this.prisma.blogArticle.update({
        where: { id: articleId },
        data: {
          meta: {
            ...existingMeta,
            images: variants,
          } as any,
        },
      });

      this.logger.log(`Image compression completed for article ${articleId}`);
    } catch (error) {
      this.logger.error(
        `Image compression failed for article ${articleId}: ${error}`,
      );
      throw error;
    }
  }

  /**
   * Handle video transcoding job
   */
  private async handleTranscodeVideo(
    job: Job<TranscodeVideoJobData>,
  ): Promise<void> {
    const { articleId, videoKey, mimeType } = job.data;
    this.logger.log(`Transcoding video for article ${articleId}: ${videoKey}`);

    // Check file size before downloading
    const sizeOk = await this.checkFileSize(
      videoKey,
      MAX_VIDEO_PROCESS_SIZE,
      'transcode-video',
    );
    if (!sizeOk) {
      this.logger.log(
        `Skipping video transcoding for article ${articleId} due to file size`,
      );
      // Set status to 'failed' so frontend knows processing was skipped
      await this.setVideoStatus(articleId, 'failed');
      return;
    }

    try {
      // Mark video as 'processing' before starting
      await this.setVideoStatus(articleId, 'processing');

      // Download original from R2
      const buffer = await this.uploadService.getFileBuffer(
        videoKey,
        'blog',
        articleId,
      );

      // Transcode to HLS
      const videoVariants =
        await this.mediaProcessorService.transcodeVideoToHls(buffer, articleId);

      // Extract video thumbnail poster (frame at 1s)
      let posterUrl: string | undefined;
      try {
        posterUrl = await this.mediaProcessorService.extractVideoThumbnail(
          buffer,
          articleId,
        );
        this.logger.log(
          `Video poster generated for article ${articleId}: ${posterUrl}`,
        );
      } catch (thumbError) {
        this.logger.warn(`Failed to generate video poster: ${thumbError}`);
        // Non-fatal — continue without poster
      }

      // Update article meta with video variants + poster + status
      const article = await this.prisma.blogArticle.findUnique({
        where: { id: articleId },
        select: { meta: true },
      });

      const existingMeta = (article?.meta as Record<string, any>) || {};
      await this.prisma.blogArticle.update({
        where: { id: articleId },
        data: {
          meta: {
            ...existingMeta,
            video: {
              ...videoVariants,
              poster: posterUrl,
              status: 'completed',
            },
          } as any,
        },
      });

      this.logger.log(`Video transcoding completed for article ${articleId}`);
    } catch (error) {
      this.logger.error(
        `Video transcoding failed for article ${articleId}: ${error}`,
      );
      // Update status to 'failed'
      await this.setVideoStatus(articleId, 'failed').catch(() => {});
      throw error;
    }
  }

  /**
   * Helper to update just the video.status field in article meta
   */
  private async setVideoStatus(
    articleId: string,
    status: string,
  ): Promise<void> {
    try {
      const article = await this.prisma.blogArticle.findUnique({
        where: { id: articleId },
        select: { meta: true },
      });
      const existingMeta = (article?.meta as Record<string, any>) || {};
      await this.prisma.blogArticle.update({
        where: { id: articleId },
        data: {
          meta: {
            ...existingMeta,
            video: {
              ...((existingMeta.video as Record<string, any>) || {}),
              status,
            },
          } as any,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to set video status for ${articleId}: ${err}`);
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} of type ${job.name} completed.`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(
      `Job ${job.id} of type ${job.name} failed (attempt ${job.attemptsMade}): ${error.message}`,
    );
  }
}
