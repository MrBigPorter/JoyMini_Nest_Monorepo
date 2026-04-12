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
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { PermissionsGuard } from '@api/common/guards/permissions.guard';
import { RequirePermission } from '@api/common/decorators/require-permission.decorator';

@ApiTags('Admin Blog - Categories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/blog/categories')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  @Get()
  @ApiOperation({ summary: '获取分类列表' })
  @RequirePermission('blog', 'category_view')
  async getCategories(@Query('search') search?: string) {
    return this.categoryService.getCategories(true, search);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取分类详情' })
  @RequirePermission('blog', 'category_view')
  async getCategory(@Param('id') id: string) {
    return this.categoryService.getCategory(id);
  }

  @Post()
  @ApiOperation({ summary: '创建分类' })
  @RequirePermission('blog', 'category_manage')
  async createCategory(
    @Body()
    body: {
      name: Record<string, string | undefined>;
      slug?: string;
      description?: Record<string, string | undefined>;
      parentId?: string;
    },
  ) {
    return this.categoryService.createCategory(body);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新分类' })
  @RequirePermission('blog', 'category_manage')
  async updateCategory(
    @Param('id') id: string,
    @Body()
    body: {
      name?: Record<string, string | undefined>;
      slug?: string;
      description?: Record<string, string | undefined>;
      parentId?: string;
    },
  ) {
    return this.categoryService.updateCategory(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除分类' })
  @RequirePermission('blog', 'category_manage')
  async deleteCategory(@Param('id') id: string) {
    return this.categoryService.deleteCategory(id);
  }
}
