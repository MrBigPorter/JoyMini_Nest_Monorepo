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
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { BlogService } from './blog.service';
import { CreateArticleDto, UpdateArticleDto, BatchImportDto } from './dto';
import { TriggerVideoTranscodeDto } from './dto/trigger-video-transcode.dto';
import { ArticleStatus } from '@prisma/client';
import { AdminJwtAuthGuard } from '@api/admin/auth/admin-jwt-auth.guard';
import { CurrentUserId } from '@api/common/decorators/user.decorator';
import { AiService } from '@api/common/ai/ai.service';
import { SystemConfigService } from '@api/admin/system-config/system-config.service';

@ApiTags('Blog')
@Controller('admin/blog')
export class BlogController {
  constructor(
    private readonly blogService: BlogService,
    private readonly aiService: AiService,
    private readonly systemConfigService: SystemConfigService,
  ) {}

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

  @Get('articles/scan-local')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '扫描本地 Markdown 文件，返回可导入的文章列表' })
  async scanLocalArticles() {
    return this.blogService.scanLocalMarkdownFiles();
  }

  @Post('articles/batch-import')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '批量导入文章（从扫描结果中选择）' })
  @ApiBody({ type: BatchImportDto })
  async batchImportArticles(
    @CurrentUserId() userId: string,
    @Body() dto: BatchImportDto,
  ) {
    return this.blogService.batchImportArticles(userId, dto);
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

  @Post('categories/:id/translate')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '手动触发分类翻译' })
  async translateCategory(
    @Param('id') id: string,
    @Body() body: { targetLang?: string },
  ) {
    return this.blogService.translateCategory(id, body?.targetLang);
  }

  @Post('tags/:id/translate')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '手动触发标签翻译' })
  async translateTag(
    @Param('id') id: string,
    @Body() body: { targetLang?: string },
  ) {
    return this.blogService.translateTag(id, body?.targetLang);
  }

  @Post('tags/batch-translate')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '批量翻译标签' })
  async batchTranslateTags(
    @Body() dto: { ids: string[]; targetLang?: string },
  ) {
    return this.blogService.batchTranslateTags(dto.ids, dto.targetLang);
  }

  @Post('categories/batch-translate')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '批量翻译分类' })
  async batchTranslateCategories(
    @Body() dto: { ids: string[]; targetLang?: string },
  ) {
    return this.blogService.batchTranslateCategories(dto.ids, dto.targetLang);
  }

  @Post('articles/:id/trigger-video-transcode')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '手动触发视频转码' })
  async triggerVideoTranscode(
    @Param('id') id: string,
    @Body() dto: TriggerVideoTranscodeDto,
  ) {
    await this.blogService.triggerVideoTranscode(id, dto.videoKey);
    return { message: 'Video transcoding job enqueued' };
  }

  @Get('ai/status')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({
    summary: '获取AI服务状态（服务等级、API Key额度、健康状况）',
  })
  async getAiStatus() {
    const serviceLevel = this.aiService.getServiceLevel();
    const usageStats = this.aiService.getUsageStats();
    const available = this.aiService.isAvailable();

    return {
      serviceLevel,
      serviceLevelLabel:
        ['DISABLED', 'MINIMAL', 'ESSENTIAL', 'FULL'][serviceLevel] || 'UNKNOWN',
      available,
      usageStats,
    };
  }

  @Get('ai/providers')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '获取可用的AI提供商列表及模型' })
  async getAiProviders() {
    return this.aiService.getAvailableProviders();
  }

  @Get('ai/provider-config')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '获取当前AI提供商/模型配置' })
  async getProviderConfig() {
    const config = await this.systemConfigService.get<{
      provider: string;
      model: string;
    }>('AI_TRANSLATION_PROVIDER', {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
    });
    // Sync cache in AiService
    this.aiService.setProviderConfig(config);
    return config;
  }

  @Patch('ai/provider-config')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '更新AI提供商/模型配置' })
  async updateProviderConfig(@Body() dto: { provider: string; model: string }) {
    await this.systemConfigService.update('AI_TRANSLATION_PROVIDER', {
      value: JSON.stringify(dto),
    });
    // Sync cache in AiService
    this.aiService.setProviderConfig(dto);
    return { success: true };
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

  @Get('untranslated-categories')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '获取指定语言下未翻译的分类列表' })
  async getUntranslatedCategories(@Query('languageCode') languageCode: string) {
    return this.blogService.getUntranslatedCategories(languageCode);
  }

  @Get('untranslated-tags')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '获取指定语言下未翻译的标签列表' })
  async getUntranslatedTags(@Query('languageCode') languageCode: string) {
    return this.blogService.getUntranslatedTags(languageCode);
  }

  @Post('translation/repair-categories-tags')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({
    summary:
      '批量修复未翻译的分类和标签（检测含中文的非 zh 字段并重新投递翻译）',
  })
  async repairUntranslatedCategoriesTags(
    @Body() body: { languageCode?: string },
  ) {
    return this.blogService.repairUntranslatedCategoriesTags(
      body?.languageCode,
    );
  }

  @Get('translation/detect-incomplete')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '检测翻译不完整的文章' })
  async detectIncompleteTranslations(@Query('lang') targetLang: string = 'en') {
    return this.blogService.detectIncompleteTranslations(targetLang);
  }

  @Post('translation/retranslate-incomplete')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '批量重新翻译不完整的文章' })
  async retranslateIncompleteArticles(@Body() body: { lang?: string }) {
    return this.blogService.retranslateIncompleteArticles(body?.lang || 'en');
  }
}
