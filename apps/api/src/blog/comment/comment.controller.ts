import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UsePipes,
  Req,
  Ip,
  Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CommentService } from './comment.service';
import { CommentStatus } from '@prisma/client';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { PermissionsGuard } from '@api/common/guards/permissions.guard';
import { RequirePermission } from '@api/common/decorators/require-permission.decorator';
import { XssSanitizePipe } from '@api/common/pipes/xss-sanitize.pipe';

@ApiTags('Admin Blog - Comments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/blog/comments')
export class CommentController {
  constructor(private readonly commentService: CommentService) {}

  @Get()
  @ApiOperation({ summary: '获取所有评论列表 (管理员)' })
  @RequirePermission('blog', 'view')
  async getAllComments(
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('status') status?: CommentStatus,
    @Query('articleId') articleId?: string,
  ) {
    return this.commentService.getAllComments({
      page,
      pageSize,
      status,
      articleId,
    });
  }

  @Post()
  @ApiOperation({ summary: '提交评论 (公开接口)' })
  @UsePipes(new XssSanitizePipe())
  async createComment(
    @Body()
    body: {
      articleId: string;
      nickname: string;
      email?: string;
      content: string;
      website?: string;
      parentId?: string;
    },
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.commentService.createComment(body.articleId, {
      nickname: body.nickname,
      email: body.email!,
      content: body.content,
      website: body.website,
      parentId: body.parentId,
      ip,
      userAgent,
    });
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: '审核通过评论' })
  @RequirePermission('blog', 'update')
  async approveComment(@Param('id') id: string) {
    return this.commentService.approveComment(id);
  }

  @Patch(':id/reject')
  @ApiOperation({ summary: '审核拒绝评论' })
  @RequirePermission('blog', 'update')
  async rejectComment(@Param('id') id: string) {
    return this.commentService.rejectComment(id);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新评论状态和回复内容 (管理员)' })
  @RequirePermission('blog', 'update')
  async updateComment(
    @Param('id') id: string,
    @Body() body: { status?: CommentStatus; reply?: Record<string, string> },
  ) {
    return this.commentService.updateComment(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除评论' })
  @RequirePermission('blog', 'delete')
  async deleteComment(@Param('id') id: string) {
    return this.commentService.deleteComment(id);
  }
}
