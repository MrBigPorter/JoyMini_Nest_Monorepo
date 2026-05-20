/**
 * 📹 Batch Re-transcode Existing Videos — LATM → ADTS Fix
 * ============================================================
 * After deploying the `-bsf:a aac_adtstoasc` FFmpeg fix, existing
 * transcoded videos still have LATM-encapsulated AAC audio that
 * breaks Android ExoPlayer. This script finds all articles with
 * previously transcoded videos and re-enqueues them for re-transcoding
 * with the new ADTS bitstream filter.
 *
 * 用法:
 *   yarn workspace @lucky/api batch-retranscode-videos
 *   或
 *   docker exec -it lucky-backend-prod \
 *     node apps/api/dist/scripts/cli/batch-retranscode-videos.js
 *
 * 安全:
 *   - 幂等: 重复运行只会重新投递已存在的 job，不会重复创建数据
 *   - 新建 job 后旧 HLS 文件会被新转码结果覆盖（同路径同文件名）
 *   - 转码期间旧视频继续可用（新文件写好后再替换）
 * ============================================================
 */

import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { loadEnvForHost } from '../utils/load-env-for-host';

loadEnvForHost();

const MEDIA_PROCESSOR_QUEUE = 'media-processor';

async function main() {
  const prisma = new PrismaClient();
  let redis: IORedis | null = null;
  let queue: Queue | null = null;

  try {
    // ── 1. Connect Redis ──
    const redisUrl =
      process.env.REDIS_URL ||
      process.env.REDIS_TLS_URL ||
      'redis://localhost:6379';
    const useTLS =
      !!process.env.REDIS_TLS_URL || redisUrl.startsWith('rediss://');

    redis = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      tls: useTLS ? {} : undefined,
    });
    queue = new Queue(MEDIA_PROCESSOR_QUEUE, {
      connection: redis,
    });

    console.log(
      `[batch-retranscode] Connected to Redis: ${redisUrl.replace(/\/\/.*@/, '//***@')}`,
    );

    // ── 2. Find articles with existing transcoded videos ──
    // Query articles where meta.contentVideo is a non-empty array
    // Prisma doesn't support JSON array length queries directly, so we fetch
    // articles with meta NOT NULL and filter in-memory.
    // Fetch all non-draft articles (we filter for video meta in-memory)
    const rawArticles = await prisma.blogArticle.findMany({
      where: {
        status: { not: 'DRAFT' },
      },
      select: {
        id: true,
        meta: true,
        contentLocalized: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    console.log(
      `[batch-retranscode] Fetched ${rawArticles.length} published articles with meta`,
    );

    // ── 3. Extract unique video keys from meta.contentVideo ──
    const videoJobs: Array<{
      articleId: string;
      videoKey: string;
      source: string;
    }> = [];
    const seenKeys = new Set<string>();

    for (const article of rawArticles) {
      const meta = article.meta as Record<string, unknown> | null;
      if (!meta) continue;

      // 3a. From meta.contentVideo[] (rich-text embedded videos + cover videos)
      const contentVideo = Array.isArray(meta.contentVideo)
        ? (meta.contentVideo as Array<{ videoKey: string }>)
        : [];

      for (const entry of contentVideo) {
        if (entry.videoKey && !seenKeys.has(entry.videoKey)) {
          seenKeys.add(entry.videoKey);
          videoJobs.push({
            articleId: article.id,
            videoKey: entry.videoKey,
            source: 'meta.contentVideo',
          });
        }
      }

      // 3b. Also scan contentLocalized HTML for <video src="..."> tags
      // that might have been missed (e.g., orphaned videos)
      const contentLocalized = article.contentLocalized as Record<
        string,
        string
      > | null;
      if (contentLocalized) {
        const videoRegex = /<video\s+[^>]*src="([^"]+)"/gi;
        for (const html of Object.values(contentLocalized)) {
          if (!html || typeof html !== 'string') continue;
          let match: RegExpExecArray | null;
          while ((match = videoRegex.exec(html)) !== null) {
            const src = match[1];
            try {
              const url = new URL(src);
              const key = url.pathname.replace(/^\//, '');
              if (
                key.startsWith('uploads/blog/') &&
                /\.(mp4|webm|mov|avi|mkv)$/i.test(key) &&
                !seenKeys.has(key)
              ) {
                seenKeys.add(key);
                videoJobs.push({
                  articleId: article.id,
                  videoKey: key,
                  source: 'contentLocalized HTML',
                });
              }
            } catch {
              // Not a valid URL — skip
            }
          }
        }
      }
    }

    console.log(
      `[batch-retranscode] Found ${videoJobs.length} unique video(s) to re-transcode across ${rawArticles.length} articles`,
    );

    if (videoJobs.length === 0) {
      console.log('[batch-retranscode] No videos to re-transcode. Done.');
      return;
    }

    // ── 4. Enqueue re-transcode jobs ──
    let enqueued = 0;
    let failed = 0;

    for (const job of videoJobs) {
      try {
        // Only re-transcode .mp4 files (the original source)
        if (!job.videoKey.endsWith('.mp4')) {
          console.log(
            `  [SKIP] ${job.videoKey} (not .mp4, source: ${job.source}, article: ${job.articleId})`,
          );
          continue;
        }

        await queue!.add('transcode-video', {
          articleId: job.articleId,
          videoKey: job.videoKey,
          mimeType: 'video/mp4',
        });

        console.log(
          `  [OK]   article=${job.articleId} key=${job.videoKey} (source: ${job.source})`,
        );
        enqueued++;
      } catch (err) {
        console.error(
          `  [FAIL] article=${job.articleId} key=${job.videoKey}: ${err instanceof Error ? err.message : err}`,
        );
        failed++;
      }
    }

    // ── 5. Summary ──
    console.log('\n========================================');
    console.log(`  Total unique videos found: ${videoJobs.length}`);
    console.log(`  Successfully enqueued:     ${enqueued}`);
    console.log(`  Failed:                    ${failed}`);
    console.log('========================================');
    console.log(
      '\nThe re-transcoded videos will use the new ADTS AAC bitstream filter.\n' +
        'Android ExoPlayer will be able to play them once jobs complete.',
    );
  } finally {
    if (queue) await queue.close();
    if (redis) await redis.quit();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[batch-retranscode] Fatal error:', err);
  process.exit(1);
});
