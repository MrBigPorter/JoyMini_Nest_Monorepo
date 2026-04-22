import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Header,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BlogService } from './blog.service';
import { CreateArticleDto, UpdateArticleDto } from './dto';
import { ArticleStatus } from '@prisma/client';
import { AdminJwtAuthGuard } from '@api/admin/auth/admin-jwt-auth.guard';
import { CurrentUserId } from '@api/common/decorators/user.decorator';

@ApiTags('Blog')
@Controller('admin/blog')
export class BlogController {
  constructor(private readonly blogService: BlogService) {}

  @Get('articles')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '获取文章列表' })
  async getArticles(
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('status') status?: ArticleStatus,
    @Query('categoryId') categoryId?: string,
    @Query('tagId') tagId?: string,
    @Query('authorId') authorId?: string,
    @Query('search') search?: string,
    @Query('locale') locale?: string,
  ) {
    console.log('BlogController: getArticles', {
      page,
      pageSize,
      status,
      categoryId,
      tagId,
      authorId,
      search,
      locale,
    });
    return this.blogService.getArticles({
      page,
      pageSize,
      status,
      categoryId,
      tagId,
      authorId,
      search,
      locale,
    });
  }

  @Get('articles/:id')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '获取文章详情' })
  async getArticle(@Param('id') id: string) {
    return this.blogService.getArticle(id, true);
  }

  @Get('articles/slug/:slug')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '通过 Slug 获取文章' })
  async getArticleBySlug(@Param('slug') slug: string) {
    return this.blogService.getArticleBySlug(slug, true);
  }

  @Post('articles')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '创建文章' })
  async createArticle(
    @CurrentUserId() userId: string,
    @Body() dto: CreateArticleDto,
  ) {
    return this.blogService.createArticle(userId, dto);
  }

  @Patch('articles/:id')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '更新文章' })
  async updateArticle(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateArticleDto,
  ) {
    return this.blogService.updateArticle(id, userId, dto);
  }

  @Delete('articles/:id')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '删除文章' })
  async deleteArticle(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
  ) {
    return this.blogService.deleteArticle(id, userId);
  }

  @Post('articles/:id/publish')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '发布文章' })
  async publishArticle(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
  ) {
    return this.blogService.publishArticle(id, userId);
  }

  @Post('articles/:id/unpublish')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '取消发布文章' })
  async unpublishArticle(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
  ) {
    return this.blogService.unpublishArticle(id, userId);
  }

  @Post('articles/:id/translate')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '手动触发文章翻译' })
  async translateArticle(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body() body: { targetLang?: string },
  ) {
    return this.blogService.translateArticle(id, userId, body?.targetLang);
  }

  @Get('translation-progress')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '获取翻译进度统计' })
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  @Header('Pragma', 'no-cache')
  @Header('Expires', '0')
  async getTranslationProgress(@Query('languageCode') languageCode?: string) {
    return this.blogService.getTranslationProgress(languageCode);
  }

  @Get('translation-jobs')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '获取翻译任务列表' })
  async getTranslationJobs() {
    return this.blogService.getTranslationJobs();
  }

  @Get('translation-jobs-detail')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '获取翻译任务详情（持久化记录）' })
  async getTranslationJobsDetail(
    @Query('targetLang') targetLang?: string,
    @Query('status') status?: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    const statusArray = status ? status.split(',') : undefined;
    return this.blogService.getTranslationJobsDetail(
      targetLang,
      statusArray,
      page,
      pageSize,
    );
  }

  @Get('translation-logs')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '获取翻译日志' })
  async getTranslationLogs(
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.blogService.getTranslationLogs({
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    });
  }

  @Get('translation-issues')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '检测翻译问题' })
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  @Header('Pragma', 'no-cache')
  @Header('Expires', '0')
  async getTranslationIssues(@Query('languageCode') languageCode?: string) {
    return this.blogService.detectTranslationIssues(languageCode);
  }

  @Post('translation-fix-batch')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '批量修复翻译问题' })
  async fixTranslationIssuesBatch(
    @Body()
    body: {
      articleIds?: string[];
      languageCode?: string;
      issueTypes?: string[];
    },
  ) {
    return this.blogService.fixTranslationIssuesBatch(body);
  }

  @Get('enabled-languages')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '获取启用语言列表' })
  async getEnabledLanguages() {
    return this.blogService.getEnabledLanguages();
  }

  @Get('untranslated-articles')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '获取指定语言下未翻译的文章列表' })
  async getUntranslatedArticles(@Query('languageCode') languageCode: string) {
    return this.blogService.getUntranslatedArticles(languageCode);
  }
}
