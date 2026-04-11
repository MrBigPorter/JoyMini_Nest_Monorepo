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
import { TagService } from './tag.service';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { PermissionsGuard } from '@api/common/guards/permissions.guard';
import { RequirePermission } from '@api/common/decorators/require-permission.decorator';

@ApiTags('Admin Blog - Tags')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/blog/tags')
export class TagController {
  constructor(private readonly tagService: TagService) {}

  @Get()
  @ApiOperation({ summary: '获取标签列表' })
  @RequirePermission('blog', 'tag_view')
  async getTags(
    @Query('sortBy') sortBy?: string,
    @Query('search') search?: string,
  ) {
    return this.tagService.getTags(true, sortBy, search);
  }

  @Get('popular')
  @ApiOperation({ summary: '获取热门标签' })
  @RequirePermission('blog', 'tag_view')
  async getPopularTags(@Query('limit') limit?: number) {
    return this.tagService.getPopularTags(limit);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取标签详情' })
  @RequirePermission('blog', 'tag_view')
  async getTag(@Param('id') id: string) {
    return this.tagService.getTag(id);
  }

  @Post()
  @ApiOperation({ summary: '创建标签' })
  @RequirePermission('blog', 'tag_manage')
  async createTag(
    @Body()
    body: {
      name: Record<string, string | undefined>;
      slug?: string;
      color?: string;
      description?: Record<string, string | undefined>;
    },
  ) {
    return this.tagService.createTag(body as any);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新标签' })
  @RequirePermission('blog', 'tag_manage')
  async updateTag(
    @Param('id') id: string,
    @Body()
    body: {
      name?: Record<string, string | undefined>;
      slug?: string;
      color?: string;
      description?: Record<string, string | undefined>;
    },
  ) {
    return this.tagService.updateTag(id, body as any);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除标签' })
  @RequirePermission('blog', 'tag_manage')
  async deleteTag(@Param('id') id: string) {
    return this.tagService.deleteTag(id);
  }
}
