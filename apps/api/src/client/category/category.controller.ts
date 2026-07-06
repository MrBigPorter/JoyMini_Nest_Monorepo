import {
  Controller,
  Get,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CategoryService } from '@api/client/category/category.service';
import { CategoryQueryDto } from '@api/client/category/dto/category-query.dto';

@Controller('categories')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class CategoryController {
  constructor(private readonly service: CategoryService) {}

  @Get()
  async list(@Query() dto: CategoryQueryDto) {
    return this.service.list(dto);
  }
}
