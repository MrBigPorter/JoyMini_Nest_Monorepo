import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import sharp from 'sharp';
import { encode as blurhashEncode } from 'blurhash';
import { UploadService } from '@api/common/upload/upload.service';

export interface ImageVariants {
  blurhash: string;
  original: string;
  large: { webp: string; jpg: string };
  medium: { webp: string; jpg: string };
  thumbnail: { webp: string; jpg: string };
}

export interface VideoVariants {
  hlsUrl: string;
  duration: number;
  qualities: string[];
  poster?: string; // URL of extracted thumbnail frame (JPEG)
  status?: string; // 'pending' | 'processing' | 'completed' | 'failed'
}

@Injectable()
export class MediaProcessorService {
  private readonly logger = new Logger(MediaProcessorService.name);

  constructor(
    @Inject(forwardRef(() => UploadService))
    private readonly uploadService: UploadService,
  ) {}

  /**
   * Compress image and generate WebP/JPEG variants + BlurHash
   */
  async compressImage(
    buffer: Buffer,
    articleId: string,
    originalKey: string,
  ): Promise<ImageVariants> {
    const folder = `uploads/blog/images/${articleId}`;
    const metadata = await sharp(buffer).metadata();
    let { width = 800, height = 600 } = metadata;

    // Protect against excessively large images that could cause Sharp memory exhaustion
    const MAX_DIMENSION = 4000;
    if (
      (width > MAX_DIMENSION || height > MAX_DIMENSION) &&
      metadata.width &&
      metadata.height
    ) {
      this.logger.warn(
        `Image too large (${width}x${height}), pre-resizing to max ${MAX_DIMENSION}px before processing`,
      );
      buffer = await sharp(buffer)
        .resize(MAX_DIMENSION, MAX_DIMENSION, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .toBuffer();
      const newMetadata = await sharp(buffer).metadata();
      width = newMetadata.width ?? MAX_DIMENSION;
      height = newMetadata.height ?? MAX_DIMENSION;
    }

    // Generate BlurHash from a tiny thumbnail (32x32)
    const blurhash = await this.generateBlurHash(buffer, width, height);

    // Generate variants
    const [thumbnailWebp, mediumWebp, largeWebp, largeJpg] = await Promise.all([
      this.resizeAndConvert(buffer, 300, 'webp'),
      this.resizeAndConvert(buffer, 800, 'webp'),
      this.resizeAndConvert(buffer, 1600, 'webp'),
      this.resizeAndConvert(buffer, 1600, 'jpeg'),
    ]);

    // Upload all variants to R2 using uploadToPublicBucket with exact key
    const publicDomain = this.getPublicDomain();

    const uploadVariant = async (
      variantBuffer: Buffer,
      name: string,
      ext: string,
    ): Promise<string> => {
      const key = `${folder}/${name}.${ext}`;
      const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      await this.uploadService.uploadToPublicBucket(
        key,
        variantBuffer,
        mimeType,
      );
      return `${publicDomain}/${key}`;
    };

    const [thumbWebpUrl, medWebpUrl, lrgWebpUrl, lrgJpgUrl] = await Promise.all(
      [
        uploadVariant(thumbnailWebp, 'thumbnail', 'webp'),
        uploadVariant(mediumWebp, 'medium', 'webp'),
        uploadVariant(largeWebp, 'large', 'webp'),
        uploadVariant(largeJpg, 'large', 'jpg'),
      ],
    );

    // Get original URL
    const originalUrl = `${publicDomain}/${originalKey}`;

    return {
      blurhash,
      original: originalUrl,
      large: { webp: lrgWebpUrl, jpg: lrgJpgUrl },
      medium: { webp: medWebpUrl, jpg: lrgJpgUrl },
      thumbnail: { webp: thumbWebpUrl, jpg: lrgJpgUrl },
    };
  }

  /**
   * Generate BlurHash from image buffer
   */
  async generateBlurHash(
    buffer: Buffer,
    width: number,
    height: number,
  ): Promise<string> {
    try {
      // Resize to a tiny 32x32 for BlurHash generation
      const tinyBuffer = await sharp(buffer)
        .resize(32, 32, { fit: 'cover' })
        .raw()
        .ensureAlpha()
        .toBuffer();

      const pixels = new Uint8ClampedArray(tinyBuffer.buffer);
      // BlurHash components: 4x3 (good balance of quality vs length)
      return blurhashEncode(pixels, 32, 32, 4, 3);
    } catch (error) {
      this.logger.warn(`Failed to generate BlurHash: ${error}`);
      return '';
    }
  }

  /**
   * Resize and convert image to target format
   */
  private async resizeAndConvert(
    buffer: Buffer,
    width: number,
    format: 'webp' | 'jpeg',
  ): Promise<Buffer> {
    // Safety clamp: never generate variants wider than 4000px
    const MAX_DIMENSION = 4000;
    const safeWidth = Math.min(width, MAX_DIMENSION);
    const pipeline = sharp(buffer).resize(safeWidth, null, {
      fit: 'cover',
      withoutEnlargement: true,
    });

    if (format === 'webp') {
      return pipeline.webp({ quality: 80 }).toBuffer();
    }
    return pipeline.jpeg({ quality: 85, progressive: true }).toBuffer();
  }

  /**
   * Extract a single frame from the video as JPEG + WebP poster/thumbnail.
   * Uses ffmpeg to grab frame at 1-second mark, then sharp to convert to WebP.
   * Returns both JPEG and WebP URLs for browser-based format selection.
   */
  async extractVideoThumbnail(
    buffer: Buffer,
    articleId: string,
    videoKey: string,
  ): Promise<{ jpg: string; webp: string }> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');
    const { execSync } = await import('child_process');

    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `thumb-${articleId}-`),
    );
    const inputPath = path.join(tmpDir, 'input.mp4');
    const outputPath = path.join(tmpDir, 'poster.jpg');

    try {
      await fs.writeFile(inputPath, buffer);

      // Extract frame at 1 second, scale to 1280px width
      // -q:v 8 balances quality (~80% visual) with file size (~150-300KB vs 300-600KB at -q:v 3)
      // -update 1 tells image2 muxer to overwrite single file (suppresses sequence pattern warning)
      execSync(
        `ffmpeg -i "${inputPath}" -ss 00:00:01 -vframes 1 -vf "scale=1280:-1" -q:v 8 -update 1 "${outputPath}"`,
        { encoding: 'utf-8', timeout: 30000 },
      );

      const posterBuffer = await fs.readFile(outputPath);
      const videoId =
        videoKey
          .split('/')
          .pop()
          ?.replace(/\.[^/.]+$/, '') || 'unknown';
      const jpgKey = `uploads/blog/videos/${articleId}/${videoId}/poster.jpg`;
      const webpKey = `uploads/blog/videos/${articleId}/${videoId}/poster.webp`;

      // Upload JPEG poster
      await this.uploadService.uploadToPublicBucket(
        jpgKey,
        posterBuffer,
        'image/jpeg',
      );

      // Also generate and upload WebP variant for ~30-50% smaller file size
      // WebP provides equivalent visual quality at lower file size, improving LCP
      try {
        const webpBuffer = await sharp(posterBuffer)
          .webp({ quality: 80 })
          .toBuffer();
        await this.uploadService.uploadToPublicBucket(
          webpKey,
          webpBuffer,
          'image/webp',
        );
      } catch (webpError) {
        this.logger.warn(
          `Failed to generate WebP poster for article ${articleId}: ${webpError}`,
        );
        // Non-fatal — continue with JPEG only
      }

      const baseUrl = `${this.getPublicDomain()}/uploads/blog/videos/${articleId}/${videoId}`;
      return {
        jpg: `${baseUrl}/poster.jpg`,
        webp: `${baseUrl}/poster.webp`,
      };
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Transcode video to HLS using ffmpeg
   * Returns the master.m3u8 URL
   */
  async transcodeVideoToHls(
    buffer: Buffer,
    articleId: string,
    videoKey: string,
  ): Promise<VideoVariants> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');
    const { execSync } = await import('child_process');

    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `hls-${articleId}-`),
    );
    const inputPath = path.join(tmpDir, 'input.mp4');
    const outputDir = path.join(tmpDir, 'hls');

    try {
      // Write input buffer to temp file
      await fs.writeFile(inputPath, buffer);

      // Create output directory
      await fs.mkdir(outputDir, { recursive: true });

      // Get video duration using ffprobe
      const durationStr = execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`,
        { encoding: 'utf-8' },
      ).trim();
      const duration = parseFloat(durationStr) || 0;

      // Get source video dimensions to preserve aspect ratio
      const probeDimensions = execSync(
        `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${inputPath}"`,
        { encoding: 'utf-8' },
      ).trim();
      const [sourceWidthStr, sourceHeightStr] = probeDimensions.split(',');
      const sourceWidth = parseInt(sourceWidthStr, 10);
      const sourceHeight = parseInt(sourceHeightStr, 10);
      // Define quality targets with FIXED standard 16:9 resolutions.
      // CRITICAL: iOS AVPlayer / VideoToolbox hard-decoder REQUIRES standard
      // resolutions (width % 16 == 0, height % 2 == 0). Non-standard dimensions
      // like 860×480 cause CoreMediaErrorDomain error -12642 (FormatUnsupported).
      // Non-16:9 source videos are handled via ffmpeg scale+pad (see below).
      interface QualityTarget {
        name: string;
        width: number; // Standard 16:9 width
        height: number; // Standard height
        bandwidth: string;
      }
      const qualityTargets: QualityTarget[] = [
        { name: '480p', width: 854, height: 480, bandwidth: '800k' },
        { name: '720p', width: 1280, height: 720, bandwidth: '2800k' },
      ];

      // Only add 1080p if source's larger dimension is >= 1080
      // Use max(w,h) for portrait video support (e.g. 1080×2336 qualifies)
      const maxSourceDimension = Math.max(sourceWidth, sourceHeight);
      if (maxSourceDimension >= 1080) {
        qualityTargets.push({
          name: '1080p',
          width: 1920,
          height: 1080,
          bandwidth: '5000k',
        });
      }

      // Generate variant m3u8 playlists
      const variantStreams: string[] = [];

      for (const qt of qualityTargets) {
        const qualityDir = path.join(outputDir, qt.name);

        // Build scale filter that handles non-16:9 source videos:
        //   1. force_original_aspect_ratio=decrease — scales source to fit
        //      within the target box while preserving aspect ratio (no stretch)
        //   2. pad — adds black bars to reach exact target resolution
        //   Result: encoded frames always have standard 16:9 dimensions.
        //   For portrait video (e.g. 1080×2336): → center with side pillarboxes
        //   For cinematic video (e.g. 1920×800): → center with top/bottom letterbox
        // NOTE: Do NOT wrap dimensions in min(iw, X) — FFmpeg's filter expression parser
        // treats the comma inside min() as a parameter delimiter, breaking the syntax.
        // force_original_aspect_ratio=decrease already prevents upscaling.
        const scaleFilter =
          `scale=${qt.width}:${qt.height}:force_original_aspect_ratio=decrease,` +
          `pad=${qt.width}:${qt.height}:(ow-iw)/2:(oh-ih)/2`;

        // MUST create subdirectory before ffmpeg writes to it — ffmpeg cannot create dirs themselves
        await fs.mkdir(qualityDir, { recursive: true });

        // Use spawn instead of exec to avoid maxBuffer overflow from ffmpeg stderr progress output.
        // child_process.exec has a default maxBuffer of 1MB which ffmpeg's continuous progress
        // output easily exceeds during long transcodes, causing silent process termination.
        await this.spawnFfmpeg(
          [
            '-i',
            inputPath,
            '-vf',
            scaleFilter,
            '-r',
            '30', // Fixed 30fps — Level 4.0 max at 1080p is 30fps; source may be 60fps
            '-threads',
            '0', // Auto-detect CPU cores
            '-c:v',
            'libx264',
            '-profile:v',
            'main', // iOS VideoToolbox only supports up to Main Profile (profile_idc=77)
            '-level',
            '4.0', // Level 4.0 covers 1080p@30fps, broadest iOS device compatibility
            '-pix_fmt',
            'yuv420p', // Required: iOS HW decoder only supports 4:2:0 chroma subsampling
            '-crf',
            '23',
            '-preset',
            'medium',
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-hls_time',
            '6',
            '-hls_playlist_type',
            'vod',
            '-hls_segment_filename',
            `${qualityDir}/segment_%03d.ts`,
            '-start_number',
            '0',
            `${qualityDir}/playlist.m3u8`,
          ],
          { timeout: 300000 }, // 5 min timeout
        );

        // CODECS attribute is REQUIRED by Apple HLS Authoring Specification for streams
        // containing H.264 video and AAC audio. Without it, iOS AVFoundation may reject
        // the stream with CoreMediaErrorDomain -12642 (FormatUnsupported) because the
        // system can't pre-validate decoder capability before attempting playback.
        // Format: avc1.<profile_hex><constraints_hex><level_hex>,mp4a.40.2 (AAC-LC)
        // Here: Main Profile (4D) + constraint_set1_flag (40) + Level 4.0 (28) = avc1.4D4028
        const codecs = 'avc1.4D4028,mp4a.40.2';
        variantStreams.push(
          `#EXT-X-STREAM-INF:BANDWIDTH=${parseInt(qt.bandwidth) * 1000},RESOLUTION=${qt.width}:${qt.height},CODECS="${codecs}"\n${qt.name}/playlist.m3u8`,
        );
      }

      // Generate master playlist
      const masterPlaylist = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '',
        ...variantStreams,
        '',
      ].join('\n');

      await fs.writeFile(path.join(outputDir, 'master.m3u8'), masterPlaylist);

      // Upload all HLS files to R2
      const videoId =
        videoKey
          .split('/')
          .pop()
          ?.replace(/\.[^/.]+$/, '') || 'unknown';
      const hlsFolder = `uploads/blog/videos/${articleId}/${videoId}/hls`;
      const publicDomain = this.getPublicDomain();

      await this.uploadDirectory(outputDir, hlsFolder);

      const hlsUrl = `${publicDomain}/${hlsFolder}/master.m3u8`;

      // Cleanup temp files
      await fs.rm(tmpDir, { recursive: true, force: true });

      return {
        hlsUrl,
        duration,
        qualities: qualityTargets.map((qt) => qt.name),
      };
    } catch (error) {
      // Cleanup on error
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      this.logger.error(`Video transcoding failed: ${error}`);
      throw error;
    }
  }

  /**
   * Execute ffmpeg via spawn (not exec) to avoid maxBuffer overflow.
   *
   * child_process.exec buffers stdout/stderr in memory with a default maxBuffer of 1MB.
   * ffmpeg continuously outputs progress information to stderr (e.g. "frame= 123 fps=3.2 ..."),
   * which easily exceeds 1MB during long transcodes. When maxBuffer is exceeded, Node.js
   * silently kills the process and throws a generic "Command failed" error without the
   * actual ffmpeg error output.
   *
   * spawn streams output via events and has no buffer limit, making it suitable for
   * long-running ffmpeg processes.
   */
  private spawnFfmpeg(
    args: string[],
    options: { timeout: number },
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const { spawn } =
        require('child_process') as typeof import('child_process');
      const child = spawn('ffmpeg', args);
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        reject(new Error(`ffmpeg timed out after ${options.timeout}ms`));
      }, options.timeout);

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        if (timedOut) return;
        if (code !== 0) {
          // Include the last 2KB of stderr for debugging the actual ffmpeg error
          const tail = stderr.slice(-2048);
          reject(new Error(`ffmpeg exited with code ${code}\n${tail}`));
        } else {
          resolve();
        }
      });

      child.on('error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * Upload a directory of files to R2 recursively
   *
   * CRITICAL UPLOAD ORDER:
   * 1. First upload all subdirectories (all quality folders, all .ts segments)
   * 2. Then upload all regular files
   * 3. Upload master.m3u8 ABSOLUTELY LAST
   *
   * This prevents Cloudflare negative caching bug where master.m3u8 appears before
   * variant playlists exist, causing 4 hour cached 404 errors even after files exist.
   */
  private async uploadDirectory(
    dirPath: string,
    r2Prefix: string,
  ): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');

    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    // Phase 1: Upload all subdirectories FIRST
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.join(dirPath, entry.name);
        await this.uploadDirectory(fullPath, `${r2Prefix}/${entry.name}`);
      }
    }

    // Phase 2: Collect and sort files
    const files: { name: string; fullPath: string }[] = [];
    let masterPlaylist: { name: string; fullPath: string } | null = null;

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.name === 'master.m3u8') {
          masterPlaylist = { name: entry.name, fullPath };
        } else {
          files.push({ name: entry.name, fullPath });
        }
      }
    }

    // Phase 3: Upload all regular files
    for (const file of files) {
      const buffer = await fs.readFile(file.fullPath);
      const mimeType = file.name.endsWith('.ts')
        ? 'video/MP2T'
        : file.name.endsWith('.m3u8')
          ? 'application/vnd.apple.mpegurl'
          : 'application/octet-stream';
      const key = `${r2Prefix}/${file.name}`;
      await this.uploadService.uploadToPublicBucket(key, buffer, mimeType);
    }

    // Phase 4: Upload master playlist LAST.  This is the critical fix.
    if (masterPlaylist) {
      const buffer = await fs.readFile(masterPlaylist.fullPath);
      const key = `${r2Prefix}/${masterPlaylist.name}`;
      await this.uploadService.uploadToPublicBucket(
        key,
        buffer,
        'application/vnd.apple.mpegurl',
      );
    }
  }

  public getPublicDomain(): string {
    // This should match the public domain from UploadService
    // We access it via the upload service's internal config
    return process.env.CF_R2_PUBLIC_DOMAIN || '';
  }
}
