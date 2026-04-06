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
  @ApiOperation({ summary: '获取文章列表' })
  async getArticles(
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('status') status?: ArticleStatus,
    @Query('categoryId') categoryId?: string,
    @Query('tagId') tagId?: string,
    @Query('authorId') authorId?: string,
    @Query('search') search?: string,
  ) {
    console.log('BlogController: getArticles', {
      page,
      pageSize,
      status,
      categoryId,
      tagId,
      authorId,
      search,
    });
    return this.blogService.getArticles({
      page,
      pageSize,
      status,
      categoryId,
      tagId,
      authorId,
      search,
    });
  }

  @Get('articles/:id')
  @ApiOperation({ summary: '获取文章详情' })
  async getArticle(@Param('id') id: string) {
    return this.blogService.getArticle(id, true);
  }

  @Get('articles/slug/:slug')
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
}
