import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { CacheTTL } from '@nestjs/cache-manager';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BlogService } from '../blog.service';
import { ArticleStatus } from '@prisma/client';
import { OtpThrottlerGuard } from '@api/common/guards/otp-throttler.guard';
import { CurrentUserId } from '@api/common/decorators/user.decorator';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { LikeDeduplicationGuard } from '../guards/like-deduplication.guard';
import { SensitiveWordFilterPipe } from '../pipes/sensitive-word-filter.pipe';
import { RecaptchaGuard } from '../guards/recaptcha.guard';

@ApiTags('Blog Public')
@Controller('v1/public/blog')
export class PublicBlogController {
  constructor(private readonly blogService: BlogService) {}

  @Get('articles')
  @ApiOperation({ summary: '公开文章列表' })
  @CacheTTL(300) // 缓存5分钟
  async getPublicArticles(
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('categoryId') categoryId?: string,
    @Query('tagId') tagId?: string,
    @Query('search') search?: string,
  ) {
    return this.blogService.getArticles({
      page,
      pageSize,
      status: ArticleStatus.PUBLISHED,
      categoryId,
      tagId,
      search,
    });
  }

  @Get('articles/:slug')
  @ApiOperation({ summary: '根据 Slug 获取公开文章' })
  @CacheTTL(600) // 缓存10分钟
  async getPublicArticleBySlug(@Param('slug') slug: string) {
    return this.blogService.getArticleBySlug(slug, false);
  }

  @Get('articles/popular')
  @ApiOperation({ summary: '热门文章列表' })
  @CacheTTL(600)
  async getPopularArticles(@Query('limit') limit = 10) {
    return this.blogService.getPopularArticles(limit);
  }

  @Get('articles/:id/related')
  @ApiOperation({ summary: '相关文章' })
  @CacheTTL(600)
  async getRelatedArticles(
    @Param('id') articleId: string,
    @Query('limit') limit = 5,
  ) {
    return this.blogService.getRelatedArticles(articleId, limit);
  }

  @Get('categories')
  @ApiOperation({ summary: '公开分类列表' })
  @CacheTTL(3600) // 缓存1小时
  async getPublicCategories() {
    return this.blogService.getCategories();
  }

  @Get('categories/:slug')
  @ApiOperation({ summary: '分类详情及分类下文章' })
  @CacheTTL(300)
  async getPublicCategoryBySlug(
    @Param('slug') slug: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.blogService.getCategoryBySlugWithArticles(slug, {
      page,
      pageSize,
      status: ArticleStatus.PUBLISHED,
    });
  }

  @Get('tags')
  @ApiOperation({ summary: '公开标签列表' })
  @CacheTTL(3600)
  async getPublicTags() {
    return this.blogService.getTags();
  }

  @Get('tags/:slug')
  @ApiOperation({ summary: '标签详情及标签下文章' })
  @CacheTTL(300)
  async getPublicTagBySlug(
    @Param('slug') slug: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.blogService.getTagBySlugWithArticles(slug, {
      page,
      pageSize,
      status: ArticleStatus.PUBLISHED,
    });
  }

  @Get('articles/:slug/comments')
  @ApiOperation({ summary: '文章评论列表' })
  @CacheTTL(60) // 缓存1分钟
  async getArticleComments(
    @Param('slug') slug: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.blogService.getArticleComments(slug, { page, pageSize });
  }

  @Get('search')
  @ApiOperation({ summary: '文章搜索' })
  async searchArticles(
    @Query('q') query: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.blogService.searchArticles(query, {
      page,
      pageSize,
      status: ArticleStatus.PUBLISHED,
    });
  }

  @Get('stats')
  @ApiOperation({ summary: '博客概览统计' })
  @CacheTTL(3600)
  async getBlogStats() {
    return this.blogService.getBlogStats();
  }

  @Get('tags/popular')
  @ApiOperation({ summary: '热门标签列表' })
  @CacheTTL(1800)
  async getPopularTags(@Query('limit') limit = 20) {
    return this.blogService.getPopularTags(limit);
  }

  @Get('archive')
  @ApiOperation({ summary: '文章归档' })
  @CacheTTL(1800)
  async getArticleArchive() {
    return this.blogService.getArticleArchive();
  }

  @Post('articles/:slug/like')
  @ApiOperation({ summary: '文章点赞' })
  @UseGuards(OtpThrottlerGuard, LikeDeduplicationGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async likeArticle(
    @Param('slug') slug: string,
    @Body('fingerprint') fingerprint: string,
  ) {
    return this.blogService.likeArticle(slug, fingerprint);
  }

  @Delete('articles/:slug/like')
  @ApiOperation({ summary: '取消文章点赞' })
  @UseGuards(OtpThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async unlikeArticle(
    @Param('slug') slug: string,
    @Body('fingerprint') fingerprint: string,
  ) {
    return this.blogService.unlikeArticle(slug, fingerprint);
  }

  @Get('articles/:slug/like/status')
  @ApiOperation({ summary: '检查点赞状态' })
  async checkLikeStatus(
    @Param('slug') slug: string,
    @Query('fingerprint') fingerprint: string,
  ) {
    return this.blogService.checkLikeStatus(slug, fingerprint);
  }

  @Post('articles/:slug/comments')
  @ApiOperation({ summary: '提交文章评论' })
  @UseGuards(OtpThrottlerGuard, JwtAuthGuard, RecaptchaGuard)
  @UsePipes(new SensitiveWordFilterPipe())
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async createComment(
    @Param('slug') slug: string,
    @Body() createCommentDto: any,
    @CurrentUserId() userId?: string | null,
  ) {
    return this.blogService.createComment(slug, createCommentDto, userId);
  }
}
