import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { extname } from 'path';
import * as mime from 'mime';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { MEDIA_PROCESSOR_QUEUE } from '@api/common/media/media-processor.constants';
import { PrismaService } from '@api/common/prisma/prisma.service';

const getMimeExtension = (mimeType: string): string | false =>
  mime.extension(mimeType) as string | false;

@Injectable()
export class UploadService {
  private readonly s3Client: S3Client;
  private readonly publicBucket: string;
  private readonly privateBucket: string;
  private readonly publicDomain: string;
  private readonly logger = new Logger(UploadService.name);

  constructor(
    private configService: ConfigService,
    @InjectQueue(MEDIA_PROCESSOR_QUEUE)
    private readonly mediaProcessorQueue: Queue,
    private readonly prisma: PrismaService,
  ) {
    // initial
    const accountId = this.configService.getOrThrow<string>('CF_R2_ACCOUNT_ID');
    const accessKeyId = this.configService.getOrThrow<string>(
      'CF_R2_ACCESS_KEY_ID',
    );
    const secretAccessKey = this.configService.getOrThrow<string>(
      'CF_R2_SECRET_ACCESS_KEY',
    );
    this.publicBucket = this.configService.getOrThrow<string>(
      'R2_BUCKET_PUBLIC',
      'mini-shop',
    );
    this.privateBucket = this.configService.getOrThrow<string>(
      'R2_BUCKET_PRIVATE',
      'mini-kyc-private',
    );
    this.publicDomain = this.configService.getOrThrow<string>(
      'CF_R2_PUBLIC_DOMAIN',
    );

    //connect to r2 Cloudflare
    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  /**
   * Key ownership check (IMPORTANT)
   *
   * Your current key format is:
   *   uploads/${module}/${userId}/${file}
   *
   * We enforce this ONLY for private modules (kyc/finance/contract/id-card).
   * For legacy data, you can optionally accept old prefixes below.
   */
  private assertOwnedKey(key: string, module: string, userId: string) {
    const normalized = (key || '').replace(/^\/+/, '');

    const allowedPrefixes = [`uploads/${module}/${userId}/`];

    const ok = allowedPrefixes.some((p) => normalized.startsWith(p));
    if (!ok) {
      throw new ConflictException('File key not owned by current user');
    }
  }

  /**
   * Internal method to upload file to S3
   * @param body
   * @param key
   * @param bucket
   * @param contentType
   * @param encrypt
   * @private
   */
  private async internalPutToS3(
    body: Buffer | Uint8Array | Blob | string,
    key: string,
    bucket: string,
    contentType: string,
    encrypt: boolean = false, // 默认不加密，按需开启
  ) {
    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ...(encrypt ? { ServerSideEncryption: 'AES256' } : {}),
        }),
      );
      this.logger.log(`File uploaded successfully to ${bucket}/${key}`);
      return { key };
    } catch (error) {
      this.logger.error('Internal Upload Error', error);
      throw new InternalServerErrorException('Internal Upload Error');
    }
  }

  /**
   * Get bucket configuration based on module
   * @param module
   * @private
   */
  private getBucketConfig(module: string) {
    //define private modules
    const privateModules = ['kyc', 'finance', 'contract', 'id-card'];

    if (privateModules.includes(module)) {
      return {
        bucket: this.privateBucket,
        isPrivate: true,
      };
    }
    return {
      bucket: this.publicBucket,
      isPrivate: false,
    };
  }

  /**
   * Get file size from S3 (via HeadObject) without downloading the file.
   * Used by workers to check if a file exceeds processing thresholds.
   * @param key - S3 object key
   * @param module - module name for bucket resolution
   * @returns file size in bytes, or 0 if object doesn't exist
   */
  async getFileSize(key: string, module: string = 'blog'): Promise<number> {
    const bucketConfig = this.getBucketConfig(module);
    try {
      const command = new HeadObjectCommand({
        Bucket: bucketConfig.bucket,
        Key: key,
      });
      const response = await this.s3Client.send(command);
      return response.ContentLength ?? 0;
    } catch (error) {
      this.logger.warn(
        `Failed to get file size for ${bucketConfig.bucket}/${key}: ${String(error)}`,
      );
      return 0;
    }
  }

  /**
   *  生成上传签名 URL (PUT)
   * 前端使用此 URL 上传文件
   */
  async generatePresignedUrl(
    userId: string,
    fileName: string,
    fileType: string,
    module: string = 'common',
  ) {
    const { bucket, isPrivate } = this.getBucketConfig(module);

    // [优化] 后缀名兜底
    let fileExt = extname(fileName);
    if (!fileExt && fileType) {
      const ext = mime.extension(fileType);
      if (ext) fileExt = `.${ext}`;
    }
    const uniqueFileName = `${uuidv4()}${fileExt}`;
    // Key 格式: uploads/kyc/user_123/xxx.jpg
    const key = `uploads/${module}/${userId}/${uniqueFileName}`;

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: fileType,
    });

    try {
      // 签发 10 分钟有效的上传链接
      const url = await getSignedUrl(this.s3Client, command, {
        expiresIn: 600,
      });

      // 2. 处理返回给前端用于发消息的 Key/URL
      let publicUrl = null;

      if (!isPrivate) {
        //  重点：如果是公开模块(chat)，直接拼接永久 CDN 链接
        // 这样前端存进数据库的就是一个永久链接，任何时候都能看
        publicUrl = `${this.publicDomain}/${key}`;
      }

      this.logger.log(`Generated upload URL for ${module} in bucket ${bucket}`);

      return {
        url, // 临时上传链接 (给前端 PUT 用)
        key, // 存数据库的 Key
        // 如果是公开桶，直接返回 CDN 链接；私有桶则不返回，强迫前端以后通过签名访问
        cdnUrl: publicUrl,
        isPrivate,
      };
    } catch (error) {
      this.logger.error('Failed to generate presigned URL', error);
      throw new Error('Could not generate upload URL');
    }
  }

  /**
   * 生成查看/下载签名 URL (GET)
   */
  async getDownloadUrl(
    key: string,
    module: string = 'common',
    userId?: string,
  ) {
    if (!key) return null;
    const normalized = key.replace(/^\/+/, '');

    // 兼容旧数据
    if (key.startsWith('http')) return key;

    const { bucket, isPrivate } = this.getBucketConfig(module);

    if (!isPrivate) {
      const domain = this.publicDomain.replace(/\/$/, '');
      return `${domain}/${normalized}`;
    }

    if (userId) {
      this.assertOwnedKey(normalized, module, userId);
    }

    // 私有桶：必须生成临时签名
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    try {
      // 签发 5 分钟有效的下载链接
      return await getSignedUrl(this.s3Client, command, {
        expiresIn: 300,
      });
    } catch (error) {
      this.logger.error(
        `Failed to generate download URL for key: ${key}`,
        error,
      );
      return null;
    }
  }

  /**
   * Get file buffer from S3
   * @param key
   * @param module
   * @param userId
   */
  async getFileBuffer(
    key: string,
    module: string = 'kyc',
    userId: string,
  ): Promise<Buffer> {
    if (!key) throw new ConflictException('Missing key');
    const normalized = key.replace(/^\/+/, '');

    const { bucket, isPrivate } = this.getBucketConfig(module);
    if (isPrivate) {
      this.assertOwnedKey(normalized, module, userId);
    }

    const data = await this.s3Client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );

    const byteArray = await data.Body!.transformToByteArray();
    return Buffer.from(byteArray); // 统一转回 Buffer
  }
  /**
   * Upload buffer to S3
   * @param buffer
   * @param module
   * @param userId
   * @param mimeType
   * @param prefix
   */
  async uploadBuffer(
    buffer: Buffer | Uint8Array,
    module: string,
    userId: string,
    mimeType: string = 'image/jpeg',
    prefix: string = 'file',
  ) {
    const { bucket, isPrivate } = this.getBucketConfig(module);

    // 根据 mimeType 简单推断后缀，或者直接生成 jpg
    // [修改点] 使用库自动获取后缀，如果没有找到则默认 .bin
    //  修复点：增加容错判断
    let extension: string;
    try {
      const resolvedExt = getMimeExtension(mimeType);
      extension =
        typeof resolvedExt === 'string' && resolvedExt.length > 0
          ? resolvedExt
          : 'jpg';
    } catch {
      extension = 'jpg'; // 兜底为 jpg
    }
    const uniqueFileName = `${prefix}_${uuidv4()}.${extension}`;

    // 生成语义化的文件名：uploads/kyc/user_123/id_front_xxxx.jpg
    const key = `uploads/${module}/${userId}/${uniqueFileName}`;

    // 强制开启加密 (encrypt = true)
    const result = await this.internalPutToS3(
      buffer,
      key,
      bucket,
      mimeType,
      true,
    );

    return {
      ...result,
      isPrivate,
    };
  }

  /**
   * Upload buffer to public bucket with a specific key (for media processor variants)
   * Unlike uploadBuffer(), this allows specifying the exact key path
   * @param key - the exact S3 key to upload to (e.g., "uploads/blog/images/articleId/thumbnail.webp")
   * @param buffer
   * @param mimeType
   */
  async uploadToPublicBucket(key: string, buffer: Buffer, mimeType: string) {
    return this.internalPutToS3(
      buffer,
      key,
      this.publicBucket,
      mimeType,
      false,
    );
  }

  /**
   * Upload file from Multer to public S3 bucket
   * Optionally enqueue media processing (compression / transcoding) for blog articles
   * @param file
   * @param folder
   * @param articleId - if provided, enqueues media processing job
   */
  async uploadFile(
    file: Express.Multer.File,
    folder: string = 'treasures',
    articleId?: string,
  ) {
    const fileExt = extname(file.originalname);
    const key = `${folder}/${uuidv4()}${fileExt}`;

    const result = await this.internalPutToS3(
      file.buffer,
      key,
      this.publicBucket,
      file.mimetype,
      false,
    );

    const url = `${this.publicDomain.replace(/\/$/, '')}/${key}`;

    // If articleId is provided, enqueue media processing job
    if (articleId) {
      const VIDEO_EXT = /\.(mp4|avi|mov|mkv|webm)$/i;
      const isVideo =
        file.mimetype.startsWith('video/') || VIDEO_EXT.test(file.originalname);
      const jobName = isVideo ? 'transcode-video' : 'compress-image';

      // For video, set initial meta status to 'pending' immediately
      if (isVideo) {
        this.prisma.blogArticle
          .findUnique({ where: { id: articleId }, select: { meta: true } })
          .then((article: { meta: unknown } | null) => {
            let existingMeta: Record<string, unknown> = {};
            if (
              article?.meta &&
              typeof article.meta === 'object' &&
              !Array.isArray(article.meta)
            ) {
              existingMeta = article.meta as Record<string, unknown>;
            }
            return this.prisma.blogArticle.update({
              where: { id: articleId },
              data: {
                meta: {
                  ...existingMeta,
                  video: {
                    status: 'pending',
                  },
                },
              },
            });
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.warn(
              `Failed to set initial video status for article ${articleId}: ${msg}`,
            );
          });
      }

      this.mediaProcessorQueue
        .add(jobName, {
          articleId,
          imageKey: key,
          videoKey: key,
          mimeType: file.mimetype,
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Failed to enqueue media processing job: ${msg}`);
        });
    }

    return {
      ...result,
      url,
      originalName: file.originalname,
    };
  }

  /**
   * Confirm a direct-to-R2 upload (presigned URL flow) and enqueue processing.
   *
   * Called after the browser has uploaded the file directly to R2 via presigned URL.
   * This method records the upload, enqueues media processing (transcode / compress),
   * and returns the public URL.
   *
   * @param key - R2 object key (from generatePresignedUrl)
   * @param originalName - original file name (for extension-based type detection)
   * @param articleId - optional, enqueues media processing if provided
   * @param mimeType - optional, the declared MIME type of the uploaded file
   * @param mediaUsage - optional (blog): 'cover' | 'content'. Helps route video transcoding output.
   */
  async confirmUpload(
    key: string,
    originalName: string,
    articleId?: string,
    mimeType?: string,
    mediaUsage?: string,
  ): Promise<{ url: string; key: string }> {
    const url = `${this.publicDomain.replace(/\/$/, '')}/${key}`;

    if (articleId) {
      const VIDEO_EXT = /\.(mp4|avi|mov|mkv|webm)$/i;
      const isVideo =
        (mimeType && mimeType.startsWith('video/')) ||
        VIDEO_EXT.test(originalName);
      const jobName = isVideo ? 'transcode-video' : 'compress-image';

      // If caller indicates this is a rich-text content video, don't touch meta.video.status
      // (meta.video is reserved for coverImage video state used on homepage cards).
      const isContentVideo = mediaUsage === 'content';

      // For video, set initial meta status to 'pending' immediately
      if (isVideo && !isContentVideo) {
        this.prisma.blogArticle
          .findUnique({ where: { id: articleId }, select: { meta: true } })
          .then((article: { meta: unknown } | null) => {
            let existingMeta: Record<string, unknown> = {};
            if (
              article?.meta &&
              typeof article.meta === 'object' &&
              !Array.isArray(article.meta)
            ) {
              existingMeta = article.meta as Record<string, unknown>;
            }
            return this.prisma.blogArticle.update({
              where: { id: articleId },
              data: {
                meta: {
                  ...existingMeta,
                  video: {
                    status: 'pending',
                  },
                },
              },
            });
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.warn(
              `Failed to set initial video status for article ${articleId}: ${msg}`,
            );
          });
      }

      this.mediaProcessorQueue
        .add(jobName, {
          articleId,
          imageKey: key,
          videoKey: key,
          mimeType: mimeType ?? 'application/octet-stream',
          mediaUsage,
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Failed to enqueue media processing job: ${msg}`);
        });
    }

    return { url, key };
  }
}
