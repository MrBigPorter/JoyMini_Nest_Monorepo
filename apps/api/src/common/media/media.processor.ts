import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, forwardRef, Logger } from '@nestjs/common';
import { MediaProcessorService } from './media-processor.service';
import { UploadService } from '@api/common/upload/upload.service';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { Prisma } from '@prisma/client';
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
  /** Optional hint from uploader: 'cover' | 'content' */
  mediaUsage?: string;
}

/**
 * Entry stored in meta.contentVideo[] for each transcoded video.
 * Allows the frontend to map a <video src="xxx.mp4"> in rich-text content
 * to its corresponding HLS m3u8 URL by matching videoKey.
 */
interface ContentVideoEntry {
  videoKey: string;
  hlsUrl: string;
  poster: string | null;
}

@Processor(MEDIA_PROCESSOR_QUEUE, {
  concurrency: 2, // Allow 2 concurrent jobs
  lockDuration: 900_000, // 15 min — increased from 5 min; video transcoding via ffmpeg execSync can exceed 5 min for large/long videos
})
export class MediaProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaProcessor.name);

  constructor(
    private readonly mediaProcessorService: MediaProcessorService,
    @Inject(forwardRef(() => UploadService))
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
    const { articleId, videoKey, mimeType, mediaUsage } = job.data;
    this.logger.log(`Transcoding video for article ${articleId}: ${videoKey}`);

    // Determine if this video is the article's coverImage.
    // 1) Prefer explicit hint from uploader (mediaUsage)
    // 2) Fall back to comparing videoKey with coverImage URL pathname
    // coverImage videos update meta.video (for homepage cards);
    // rich-text content videos only update meta.contentVideo[] (for detail page).
    const article = await this.prisma.blogArticle.findUnique({
      where: { id: articleId },
      select: { coverImage: true, coverImageLocalized: true },
    });
    const coverKeys = new Set<string>();
    if (article?.coverImage) {
      try {
        const url = new URL(article.coverImage);
        coverKeys.add(url.pathname.replace(/^\//, ''));
      } catch {
        /* ignore invalid URL */
      }
    }
    // Also check localized cover images
    if (article?.coverImageLocalized) {
      try {
        const localized = article.coverImageLocalized as Record<string, string>;
        for (const url of Object.values(localized)) {
          try {
            const parsed = new URL(url);
            coverKeys.add(parsed.pathname.replace(/^\//, ''));
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
    }
    const isCoverImageVideo =
      mediaUsage === 'cover'
        ? true
        : mediaUsage === 'content'
          ? false
          : coverKeys.has(videoKey);

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
      // Only set meta.video.status for cover videos
      if (isCoverImageVideo) {
        await this.setVideoStatus(articleId, 'failed');
      }
      return;
    }

    try {
      // Mark meta.video.status only for cover videos
      if (isCoverImageVideo) {
        await this.setVideoStatus(articleId, 'processing');
      }

      // Download original from R2
      const buffer = await this.uploadService.getFileBuffer(
        videoKey,
        'blog',
        articleId,
      );

      // Transcode to HLS
      const videoVariants =
        await this.mediaProcessorService.transcodeVideoToHls(
          buffer,
          articleId,
          videoKey,
        );

      // Extract video thumbnail poster (frame at 1s) — returns both JPEG and WebP URLs
      let posterUrl: { jpg: string; webp: string } | undefined;
      try {
        posterUrl = await this.mediaProcessorService.extractVideoThumbnail(
          buffer,
          articleId,
          videoKey,
        );
        this.logger.log(
          `Video poster generated for article ${articleId}: ${posterUrl?.jpg}`,
        );
      } catch (thumbError) {
        this.logger.warn(`Failed to generate video poster: ${thumbError}`);
        // Non-fatal — continue without poster
      }

      // Update article meta with video variants + poster + status
      const articleMeta = await this.prisma.blogArticle.findUnique({
        where: { id: articleId },
        select: { meta: true },
      });

      const existingMeta = (articleMeta?.meta as Record<string, unknown>) || {};
      const existingContentVideo = Array.isArray(existingMeta.contentVideo)
        ? (existingMeta.contentVideo as ContentVideoEntry[])
        : [];

      if (isCoverImageVideo) {
        // ── CoverImage video: update meta.video for homepage cards ──
        // Find existing entry in contentVideo[] by videoKey to avoid duplicates
        const existingIdx = existingContentVideo.findIndex(
          (e) => e.videoKey === videoKey,
        );
        const updatedContentVideo = [...existingContentVideo];
        const newEntry: ContentVideoEntry = {
          videoKey,
          hlsUrl: videoVariants.hlsUrl,
          poster: posterUrl?.jpg ?? null,
        };
        if (existingIdx >= 0) {
          updatedContentVideo[existingIdx] = newEntry;
        } else {
          updatedContentVideo.push(newEntry);
        }

        const articleRecord = await this.prisma.blogArticle.findUnique({
          where: { id: articleId },
          select: { coverImage: true, coverImageLocalized: true },
        });

        await this.prisma.blogArticle.update({
          where: { id: articleId },
          data: {
            // Auto-fill coverImage from video poster if not already set
            ...(posterUrl?.jpg && !articleRecord?.coverImage
              ? { coverImage: posterUrl.jpg }
              : {}),
            meta: {
              ...existingMeta,
              video: {
                ...videoVariants,
                poster: posterUrl?.jpg,
                posterWebp: posterUrl?.webp,
                status: 'completed',
              },
              contentVideo: updatedContentVideo,
            } as unknown as Prisma.InputJsonValue,
          },
        });

        this.logger.log(
          `CoverImage video transcoding completed for article ${articleId}: meta.video updated`,
        );
      } else {
        // ── Content (rich-text) video: only update meta.contentVideo[] ──
        // Do NOT touch meta.video to avoid overwriting the coverImage video's data.
        const existingIdx = existingContentVideo.findIndex(
          (e) => e.videoKey === videoKey,
        );
        const updatedContentVideo = [...existingContentVideo];
        const newEntry: ContentVideoEntry = {
          videoKey,
          hlsUrl: videoVariants.hlsUrl,
          poster: posterUrl?.jpg ?? null,
        };
        if (existingIdx >= 0) {
          updatedContentVideo[existingIdx] = newEntry;
        } else {
          updatedContentVideo.push(newEntry);
        }

        await this.prisma.blogArticle.update({
          where: { id: articleId },
          data: {
            meta: {
              ...existingMeta,
              contentVideo: updatedContentVideo,
            } as unknown as Prisma.InputJsonValue,
          },
        });

        // NOTE: Content is NOT modified here. We keep the original mp4 URL in content;
        // frontend ArticleMarkdown looks up meta.contentVideo[] by videoKey to find HLS URL at render time.

        this.logger.log(
          `Content video transcoding completed for article ${articleId}: meta.contentVideo[] updated`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Video transcoding failed for article ${articleId}: ${error}`,
      );
      // Update meta.video.status only for cover videos
      if (isCoverImageVideo) {
        await this.setVideoStatus(articleId, 'failed').catch(() => {});
      }
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
