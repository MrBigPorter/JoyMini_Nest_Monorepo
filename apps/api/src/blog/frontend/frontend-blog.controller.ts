import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Req,
  Body,
  NotFoundException,
  UseGuards,
  UseInterceptors,
  Sse,
  MessageEvent,
} from '@nestjs/common';

import { CacheTTL } from '@nestjs/cache-manager';
import { PublicCacheInterceptor } from '@api/common/cache/public-cache.interceptor';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FrontendBlogService } from './frontend-blog.service';
import { BlogService } from '../blog.service';
import { LanguageService } from '@api/common/services/language.service';
import { CreateCommentDto } from '../dto/create-comment.dto';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';

@ApiTags('Frontend Blog')
@Controller('frontend/blog')
@UseInterceptors(PublicCacheInterceptor)
export class FrontendBlogController {
  constructor(
    private readonly frontendBlogService: FrontendBlogService,
    private readonly blogService: BlogService,
    private readonly languageService: LanguageService,
    private eventEmitter: EventEmitter2,
  ) {}

  @Get('articles')
  @ApiOperation({ summary: '前端博客文章列表（简化版）' })
  @ApiResponse({ status: 200, description: '返回文章列表' })
  @CacheTTL(300) // 缓存5分钟
  async getFrontendArticles(
    @Req() req: Request,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('categoryId') categoryId?: string,
    @Query('tagId') tagId?: string,
  ) {
    // 解析请求语言
    const locale = this.languageService.resolveLanguage(req);

    return this.frontendBlogService.getFrontendArticles({
      page,
      pageSize,
      categoryId,
      tagId,
      locale,
    });
  }

  @Get('featured')
  @ApiOperation({ summary: '获取精选文章列表（用于首页 Hero 区域）' })
  @ApiResponse({ status: 200, description: '返回精选文章列表' })
  @CacheTTL(300) // 缓存5分钟
  async getFrontendFeaturedArticles(@Req() req: Request) {
    const locale = this.languageService.resolveLanguage(req);
    return this.frontendBlogService.getFrontendFeaturedArticles(locale);
  }

  @Get('articles/:slug')
  @ApiOperation({ summary: '根据 Slug 获取前端博客文章详情（简化版）' })
  @ApiResponse({ status: 200, description: '返回文章详情' })
  @ApiResponse({ status: 404, description: '文章不存在' })
  @CacheTTL(600) // 缓存10分钟
  async getFrontendArticleBySlug(
    @Param('slug') slug: string,
    @Req() req: Request,
  ) {
    // 解析请求语言
    const locale = this.languageService.resolveLanguage(req);

    const article = await this.frontendBlogService.getFrontendArticleBySlug(
      slug,
      locale,
    );

    if (!article) {
      throw new NotFoundException(`文章 ${slug} 不存在`);
    }

    return article;
  }

  @Get('articles/popular')
  @ApiOperation({ summary: '前端博客热门文章列表（简化版）' })
  @ApiResponse({ status: 200, description: '返回热门文章列表' })
  @CacheTTL(600) // 缓存10分钟
  async getFrontendPopularArticles(
    @Query('limit') limit = 10,
    @Req() req: Request,
  ) {
    // 解析请求语言
    const locale = this.languageService.resolveLanguage(req);

    return this.frontendBlogService.getFrontendPopularArticles(limit, locale);
  }

  @Get('articles/:id/related')
  @ApiOperation({ summary: '前端博客相关文章（简化版）' })
  @ApiResponse({ status: 200, description: '返回相关文章列表' })
  @CacheTTL(600) // 缓存10分钟
  async getFrontendRelatedArticles(
    @Param('id') articleId: string,
    @Query('limit') limit = 5,
    @Req() req: Request,
  ) {
    // 解析请求语言
    const locale = this.languageService.resolveLanguage(req);

    return this.frontendBlogService.getFrontendRelatedArticles(
      articleId,
      limit,
      locale,
    );
  }

  @Get('categories')
  @ApiOperation({ summary: '前端博客分类列表（简化版）' })
  @ApiResponse({ status: 200, description: '返回分类列表' })
  @CacheTTL(3600) // 缓存1小时
  async getFrontendCategories(@Req() req: Request) {
    // 解析请求语言
    const locale = this.languageService.resolveLanguage(req);

    return this.frontendBlogService.getFrontendCategories(locale);
  }

  @Get('categories/:slug')
  @ApiOperation({ summary: '前端博客分类详情（简化版）' })
  @ApiResponse({ status: 200, description: '返回分类详情及文章' })
  @ApiResponse({ status: 404, description: '分类不存在' })
  @CacheTTL(300) // 缓存5分钟
  async getFrontendCategoryBySlug(
    @Param('slug') slug: string,
    @Req() req: Request,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    // 解析请求语言
    const locale = this.languageService.resolveLanguage(req);

    const category = await this.frontendBlogService.getFrontendCategoryBySlug(
      slug,
      {
        page,
        pageSize,
        locale,
      },
    );

    if (!category) {
      throw new NotFoundException(`分类 ${slug} 不存在`);
    }

    return category;
  }

  @Get('tags')
  @ApiOperation({ summary: '前端博客标签列表（简化版）' })
  @ApiResponse({ status: 200, description: '返回标签列表' })
  @CacheTTL(3600) // 缓存1小时
  async getFrontendTags(@Req() req: Request) {
    // 解析请求语言
    const locale = this.languageService.resolveLanguage(req);

    return this.frontendBlogService.getFrontendTags(locale);
  }

  @Get('tags/:slug')
  @ApiOperation({ summary: '前端博客标签详情（简化版）' })
  @ApiResponse({ status: 200, description: '返回标签详情及文章' })
  @ApiResponse({ status: 404, description: '标签不存在' })
  @CacheTTL(300) // 缓存5分钟
  async getFrontendTagBySlug(
    @Param('slug') slug: string,
    @Req() req: Request,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    // 解析请求语言
    const locale = this.languageService.resolveLanguage(req);

    const tag = await this.frontendBlogService.getFrontendTagBySlug(slug, {
      page,
      pageSize,
      locale,
    });

    if (!tag) {
      throw new NotFoundException(`标签 ${slug} 不存在`);
    }

    return tag;
  }

  @Get('search')
  @ApiOperation({ summary: '前端博客文章搜索（简化版）' })
  @ApiResponse({ status: 200, description: '返回搜索结果' })
  async searchFrontendArticles(
    @Query('q') query: string,
    @Req() req: Request,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    // 解析请求语言
    const locale = this.languageService.resolveLanguage(req);

    return this.frontendBlogService.searchFrontendArticles(query, {
      page,
      pageSize,
      locale,
    });
  }

  @Get('stats')
  @ApiOperation({ summary: '前端博客概览统计（简化版）' })
  @ApiResponse({ status: 200, description: '返回博客统计' })
  @CacheTTL(3600) // 缓存1小时
  async getFrontendBlogStats() {
    return this.frontendBlogService.getFrontendBlogStats();
  }

  @Get('archive')
  @ApiOperation({ summary: '前端博客文章归档（简化版）' })
  @ApiResponse({ status: 200, description: '返回文章归档' })
  @CacheTTL(1800) // 缓存30分钟
  async getFrontendArticleArchive() {
    return this.frontendBlogService.getFrontendArticleArchive();
  }

  @Get('tags/popular')
  @ApiOperation({ summary: '前端博客热门标签（简化版）' })
  @ApiResponse({ status: 200, description: '返回热门标签列表' })
  @CacheTTL(1800) // 缓存30分钟
  async getFrontendPopularTags(@Query('limit') limit = 20) {
    return this.frontendBlogService.getFrontendPopularTags(limit);
  }

  // ================= 评论接口 =================

  @Get('articles/:slug/comments')
  @ApiOperation({ summary: '文章评论列表（前端专用）' })
  @ApiResponse({ status: 200, description: '返回评论列表' })
  @ApiResponse({ status: 404, description: '文章不存在' })
  @CacheTTL(60) // 缓存1分钟
  async getArticleComments(
    @Param('slug') slug: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.blogService.getArticleComments(slug, { page, pageSize });
  }

  @Post('articles/:slug/comments')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '提交评论（前端专用）' })
  @ApiResponse({ status: 201, description: '评论提交成功' })
  @ApiResponse({ status: 401, description: '未授权，请先登录' })
  @ApiResponse({ status: 404, description: '文章不存在' })
  async createComment(
    @Param('slug') slug: string,
    @Body() createCommentDto: CreateCommentDto,
  ) {
    return this.blogService.createComment(slug, createCommentDto);
  }

  // ================= SSE 实时推送 =================
  // 注意：静态路由 comments/stream 必须在动态路由 comments/:id/* 之前注册，否则会被遮蔽

  @Get('comments/stream')
  @Sse()
  @ApiOperation({ summary: 'SSE 评论回复实时推送（前端专用）' })
  @ApiResponse({ status: 200, description: '返回 SSE 事件流' })
  commentStream(
    @Req() req: Request,
    @Query('articleId') articleId?: string,
  ): Observable<MessageEvent> {
    const logger = new (require('@nestjs/common').Logger)('SSE');
    logger.log(
      `[SSE] 新订阅者连接, articleId filter="${articleId ?? '(全部)'}"`,
    );

    return new Observable<MessageEvent>((subscriber) => {
      let cleanedUp = false;

      // --- 安全兜底清理：HTTP 连接断开时强制释放资源 ---
      const forceCleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        this.eventEmitter.off('blog.comment.reply.created', replyHandler);
        this.eventEmitter.off('blog.comment.moderated', moderatedHandler);
        if (!subscriber.closed) {
          subscriber.unsubscribe();
        }
        logger.log(
          `[SSE] 连接关闭 (req.on('close')), articleId filter="${articleId}"`,
        );
      };
      req.on('close', forceCleanup);

      // --- handler: AI 自动回复 ---
      const replyHandler = (payload: {
        articleId: string;
        parentId: string;
        replyId: string;
        content: string;
        author: string;
        createdAt: string;
      }) => {
        if (cleanedUp) return;
        logger.debug(
          `[SSE] 收到 event: articleId=${payload.articleId}, parentId=${payload.parentId}, replyId=${payload.replyId}`,
        );

        if (!articleId || payload.articleId === articleId) {
          logger.log(
            `[SSE] ✅ 推送给订阅者 (filter="${articleId}"): replyId=${payload.replyId}`,
          );
          subscriber.next({
            data: { type: 'reply', ...payload },
          } as MessageEvent);
        } else {
          logger.debug(
            `[SSE] ⏭ 跳过: event.articleId=${payload.articleId} ≠ filter=${articleId}`,
          );
        }
      };

      // --- handler: 审核结果（替代前端轮询）---
      const moderatedHandler = (payload: {
        commentId: string;
        articleId: string;
        status: 'approved' | 'rejected';
      }) => {
        if (cleanedUp) return;
        if (!articleId || payload.articleId === articleId) {
          logger.log(
            `[SSE] ✅ 推送审核结果 (filter="${articleId}"): commentId=${payload.commentId}, status=${payload.status}`,
          );
          subscriber.next({
            data: { type: 'moderated', ...payload },
          } as MessageEvent);
        }
      };

      this.eventEmitter.on('blog.comment.reply.created', replyHandler);
      this.eventEmitter.on('blog.comment.moderated', moderatedHandler);
      logger.log(
        `[SSE] handler 已注册, 当前监听器数: ${this.eventEmitter.listenerCount('blog.comment.reply.created')}`,
      );

      // 客户端断开连接时清理
      return () => {
        forceCleanup();
        logger.log(`[SSE] 订阅者断开, articleId filter="${articleId}"`);
      };
    });
  }

  // ================= 动态路由（必须在静态路由 comments/stream 之后）=================

  @Get('comments/:id/status')
  @ApiOperation({ summary: '查询评论状态（前端专用）' })
  @ApiResponse({ status: 200, description: '返回评论状态' })
  @ApiResponse({ status: 404, description: '评论不存在' })
  async getCommentStatus(@Param('id') commentId: string) {
    return this.blogService.getCommentStatus(commentId);
  }

  @Get('comments/:id/replies')
  @ApiOperation({ summary: '查询评论的回复列表（前端专用）' })
  @ApiResponse({ status: 200, description: '返回评论的回复列表' })
  @ApiResponse({ status: 404, description: '评论不存在' })
  async getCommentReplies(@Param('id') commentId: string) {
    return this.blogService.getCommentReplies(commentId);
  }
}
