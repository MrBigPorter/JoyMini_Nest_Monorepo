import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { createHash } from 'crypto';
import { RedisService } from '@api/common/redis/redis.service';

/**
 * 点赞去重防护Guard
 * 基于IP + UserAgent + 文章ID生成唯一指纹
 * 防止同一用户24小时内重复点赞同一文章
 */
@Injectable()
export class LikeDeduplicationGuard implements CanActivate {
  constructor(private readonly redisService: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const articleSlug = request.params.slug;

    if (!articleSlug) {
      return true;
    }

    try {
      // 生成服务器端指纹
      const serverFingerprint = this.generateFingerprint(request, articleSlug);
      const redisKey = `blog:like:fingerprint:${serverFingerprint}`;

      // 检查是否已点赞
      const exists = await this.redisService.get(redisKey);

      if (exists !== null) {
        // 键已存在, 重复点赞
        throw new HttpException(
          'You have already liked this article. Please wait for 24 hours before liking again.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // 写入Redis 24小时过期
      await this.redisService.set(redisKey, Date.now().toString(), 86400);

      // 将指纹注入请求上下文
      request.body.serverFingerprint = serverFingerprint;

      return true;
    } catch (error) {
      // Redis异常时降级放行, 不影响核心功能
      if (error instanceof HttpException) {
        throw error;
      }
      console.error('Like deduplication guard error:', error);
      return true;
    }
  }

  /**
   * 生成唯一用户指纹
   * 算法: MD5(IP + UserAgent + 文章Slug + 固定盐值)
   */
  private generateFingerprint(request: Request, articleSlug: string): string {
    const ip = request.ip || request.connection.remoteAddress || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    const salt = 'blog_like_salt_2026';

    const raw = `${ip}:${userAgent}:${articleSlug}:${salt}`;

    return createHash('md5').update(raw).digest('hex');
  }
}
