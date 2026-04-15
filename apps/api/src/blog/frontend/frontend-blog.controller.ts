import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  NotFoundException,
} from '@nestjs/common';
import { CacheTTL } from '@nestjs/cache-manager';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Request } from 'express';
import { FrontendBlogService } from './frontend-blog.service';
import { LanguageService } from '@api/common/services/language.service';

@ApiTags('Frontend Blog')
@Controller('frontend/blog')
export class FrontendBlogController {
  constructor(
    private readonly frontendBlogService: FrontendBlogService,
    private readonly languageService: LanguageService,
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
}
