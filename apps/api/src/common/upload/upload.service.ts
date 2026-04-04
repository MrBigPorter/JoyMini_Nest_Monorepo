import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { extname } from 'path';
import * as mime from 'mime';

const getMimeExtension = (mimeType: string): string | false =>
  mime.extension(mimeType) as string | false;

@Injectable()
export class UploadService {
  private readonly s3Client: S3Client;
  private readonly publicBucket: string;
  private readonly privateBucket: string;
  private readonly publicDomain: string;
  private readonly logger = new Logger(UploadService.name);

  constructor(private configService: ConfigService) {
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
   * Upload file from Multer to public S3 bucket
   * @param file
   * @param folder
   */
  async uploadFile(file: Express.Multer.File, folder: string = 'treasures') {
    const fileExt = extname(file.originalname);
    const key = `${folder}/${uuidv4()}${fileExt}`;

    const result = await this.internalPutToS3(
      file.buffer,
      key,
      this.publicBucket,
      file.mimetype,
      false,
    );

    return {
      ...result,
      url: `${this.publicDomain.replace(/\/$/, '')}/${key}`,
      originalName: file.originalname,
    };
  }
}
