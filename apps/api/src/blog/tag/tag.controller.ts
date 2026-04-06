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
import { AdminJwtAuthGuard } from '@api/admin/auth/admin-jwt-auth.guard';

@ApiTags('Blog - Tags')
@Controller('admin/blog/tags')
export class TagController {
  constructor(private readonly tagService: TagService) {}

  @Get()
  @ApiOperation({ summary: '获取标签列表 (公开)' })
  async getTags(
    @Query('sortBy') sortBy?: string,
    @Query('search') search?: string,
  ) {
    return this.tagService.getTags(true, sortBy, search);
  }

  @Get('popular')
  @ApiOperation({ summary: '获取热门标签 (公开)' })
  async getPopularTags(@Query('limit') limit?: number) {
    return this.tagService.getPopularTags(limit);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取标签详情 (公开)' })
  async getTag(@Param('id') id: string) {
    return this.tagService.getTag(id);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '创建标签' })
  async createTag(
    @Body()
    body: {
      name: string;
      slug?: string;
      color?: string;
      description?: string;
    },
  ) {
    return this.tagService.createTag(body);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '更新标签' })
  async updateTag(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      slug?: string;
      color?: string;
      description?: string;
    },
  ) {
    return this.tagService.updateTag(id, body);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '删除标签' })
  async deleteTag(@Param('id') id: string) {
    return this.tagService.deleteTag(id);
  }
}
