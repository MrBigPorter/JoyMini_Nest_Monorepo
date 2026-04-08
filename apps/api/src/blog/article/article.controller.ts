import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ArticleService } from './article.service';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { PermissionsGuard } from '@api/common/guards/permissions.guard';
import { RequirePermission } from '@api/common/decorators/require-permission.decorator';

@ApiTags('Admin Blog - Articles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/blog/articles')
export class ArticleController {
  constructor(private readonly articleService: ArticleService) {}

  @Get()
  @ApiOperation({ summary: '获取文章列表' })
  @RequirePermission('blog', 'view')
  async getArticles() {
    return this.articleService.getArticles();
  }

  @Get(':id')
  @ApiOperation({ summary: '获取文章详情' })
  @RequirePermission('blog', 'view')
  async getArticle(@Param('id') id: string) {
    return this.articleService.getArticle(id);
  }

  @Post()
  @ApiOperation({ summary: '创建文章' })
  @RequirePermission('blog', 'create')
  async createArticle(@Body() body: any) {
    return this.articleService.createArticle(body);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新文章' })
  @RequirePermission('blog', 'update')
  async updateArticle(@Param('id') id: string, @Body() body: any) {
    return this.articleService.updateArticle(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除文章' })
  @RequirePermission('blog', 'delete')
  async deleteArticle(@Param('id') id: string) {
    return this.articleService.deleteArticle(id);
  }

  @Post(':id/publish')
  @ApiOperation({ summary: '发布文章' })
  @RequirePermission('blog', 'update')
  async publishArticle(@Param('id') id: string) {
    return this.articleService.publishArticle(id);
  }

  @Post(':id/unpublish')
  @ApiOperation({ summary: '取消发布文章' })
  @RequirePermission('blog', 'update')
  async unpublishArticle(@Param('id') id: string) {
    return this.articleService.unpublishArticle(id);
  }

  @Post(':id/translate')
  @ApiOperation({ summary: '手动触发文章翻译' })
  @RequirePermission('blog', 'update')
  async translateArticle(@Param('id') id: string) {
    return this.articleService.translateArticle(id);
  }
}
