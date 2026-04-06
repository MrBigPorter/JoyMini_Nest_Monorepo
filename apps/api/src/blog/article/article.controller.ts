import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ArticleService } from './article.service';

@ApiTags('Blog - Articles')
@Controller('admin/blog/articles')
export class ArticleController {
  constructor(private readonly articleService: ArticleService) {}

  @Get()
  @ApiOperation({ summary: '获取文章列表 (公开)' })
  async getArticles() {
    return this.articleService.getArticles();
  }

  @Get(':id')
  @ApiOperation({ summary: '获取文章详情 (公开)' })
  async getArticle(@Param('id') id: string) {
    return this.articleService.getArticle(id);
  }

  @Post()
  @ApiOperation({ summary: '创建文章' })
  async createArticle(@Body() body: any) {
    return this.articleService.createArticle(body);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新文章' })
  async updateArticle(@Param('id') id: string, @Body() body: any) {
    return this.articleService.updateArticle(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除文章' })
  async deleteArticle(@Param('id') id: string) {
    return this.articleService.deleteArticle(id);
  }

  @Post(':id/publish')
  @ApiOperation({ summary: '发布文章' })
  async publishArticle(@Param('id') id: string) {
    return this.articleService.publishArticle(id);
  }

  @Post(':id/unpublish')
  @ApiOperation({ summary: '取消发布文章' })
  async unpublishArticle(@Param('id') id: string) {
    return this.articleService.unpublishArticle(id);
  }
}
