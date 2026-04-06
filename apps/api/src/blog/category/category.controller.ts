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
import { CategoryService } from './category.service';
import { AdminJwtAuthGuard } from '@api/admin/auth/admin-jwt-auth.guard';

@ApiTags('Blog - Categories')
@Controller('admin/blog/categories')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  @Get()
  @ApiOperation({ summary: '获取分类列表 (公开)' })
  async getCategories(@Query('search') search?: string) {
    return this.categoryService.getCategories(true, search);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取分类详情 (公开)' })
  async getCategory(@Param('id') id: string) {
    return this.categoryService.getCategory(id);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '创建分类' })
  async createCategory(
    @Body()
    body: {
      name: string;
      slug?: string;
      description?: string;
      parentId?: string;
    },
  ) {
    return this.categoryService.createCategory(body);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '更新分类' })
  async updateCategory(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      slug?: string;
      description?: string;
      parentId?: string;
    },
  ) {
    return this.categoryService.updateCategory(id, body);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '删除分类' })
  async deleteCategory(@Param('id') id: string) {
    return this.categoryService.deleteCategory(id);
  }
}
