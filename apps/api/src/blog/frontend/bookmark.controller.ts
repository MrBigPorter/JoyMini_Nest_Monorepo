import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Req,
  UseGuards,
  Body,
  ParseIntPipe,
} from '@nestjs/common';
import { BookmarkService } from './bookmark.service';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { Request } from 'express';
import { LanguageService } from '@api/common/services/language.service';

@ApiTags('frontend-blog-bookmarks')
@Controller('frontend/blog')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class BookmarkController {
  constructor(
    private readonly bookmarkService: BookmarkService,
    private readonly languageService: LanguageService,
  ) {}

  @Get('bookmarks')
  @ApiOperation({ summary: '获取用户收藏列表' })
  @ApiQuery({ name: 'page', required: false, description: '页码，默认为1' })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    description: '每页数量，默认为10',
  })
  @ApiQuery({
    name: 'lang',
    required: false,
    description: '语言代码，默认为zh，支持 lang 或 locale 参数',
  })
  @ApiResponse({ status: 200, description: '返回收藏列表' })
  @ApiResponse({ status: 401, description: '未授权' })
  async getBookmarks(
    @Req() req: Request,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize?: number,
  ) {
    // 使用 LanguageService 解析语言，与其他前端端点保持一致
    // 支持 lang 查询参数、locale 查询参数、Accept-Language 头部
    const locale = this.languageService.resolveLanguage(req);

    return this.bookmarkService.getUserBookmarks(req.user.id, {
      page,
      pageSize,
      locale,
    });
  }

  @Post('articles/:id/bookmark')
  @ApiOperation({ summary: '收藏文章' })
  @ApiResponse({ status: 201, description: '收藏成功' })
  @ApiResponse({ status: 401, description: '未授权' })
  @ApiResponse({ status: 404, description: '文章不存在' })
  async addBookmark(@Req() req: Request, @Param('id') articleId: string) {
    return this.bookmarkService.addBookmark(req.user.id, articleId);
  }

  @Delete('articles/:id/bookmark')
  @ApiOperation({ summary: '取消收藏' })
  @ApiResponse({ status: 200, description: '取消收藏成功' })
  @ApiResponse({ status: 401, description: '未授权' })
  @ApiResponse({ status: 404, description: '收藏记录不存在' })
  async removeBookmark(@Req() req: Request, @Param('id') articleId: string) {
    return this.bookmarkService.removeBookmark(req.user.id, articleId);
  }

  @Get('articles/:id/bookmark-status')
  @ApiOperation({ summary: '检查文章收藏状态' })
  @ApiResponse({ status: 200, description: '返回收藏状态' })
  @ApiResponse({ status: 401, description: '未授权' })
  async checkBookmarkStatus(
    @Req() req: Request,
    @Param('id') articleId: string,
  ) {
    return this.bookmarkService.checkBookmarkStatus(req.user.id, articleId);
  }

  @Post('articles/batch-bookmark-status')
  @ApiOperation({ summary: '批量查询文章收藏状态' })
  @ApiResponse({ status: 200, description: '返回批量收藏状态' })
  @ApiResponse({ status: 401, description: '未授权' })
  @ApiResponse({ status: 400, description: '请求参数无效' })
  async batchCheckBookmarkStatus(
    @Req() req: Request,
    @Body() dto: { articleIds: string[] },
  ) {
    return this.bookmarkService.batchCheckBookmarkStatus(
      req.user.id,
      dto.articleIds,
    );
  }
}
