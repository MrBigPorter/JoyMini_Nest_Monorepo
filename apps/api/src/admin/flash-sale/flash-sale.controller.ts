import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { FlashSaleService } from './flash-sale.service';
import {
  BindFlashSaleProductDto,
  CreateFlashSaleSessionDto,
  UpdateFlashSaleProductDto,
  UpdateFlashSaleSessionDto,
} from './dto/flash-sale.dto';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@lucky/shared';

@Controller('admin/flash-sale')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class FlashSaleController {
  constructor(private readonly service: FlashSaleService) {}

  // ── 场次 ─────────────────────────────────────────────────────────

  /** GET /v1/admin/flash-sale/sessions */
  @Get('sessions')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR, Role.VIEWER)
  getSessions() {
    return this.service.getSessions();
  }

  /** POST /v1/admin/flash-sale/sessions */
  @Post('sessions')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR)
  createSession(@Body() dto: CreateFlashSaleSessionDto) {
    return this.service.createSession(dto);
  }

  /** PATCH /v1/admin/flash-sale/sessions/:id */
  @Patch('sessions/:id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR)
  updateSession(
    @Param('id') id: string,
    @Body() dto: UpdateFlashSaleSessionDto,
  ) {
    return this.service.updateSession(id, dto);
  }

  /** DELETE /v1/admin/flash-sale/sessions/:id */
  @Delete('sessions/:id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  deleteSession(@Param('id') id: string) {
    return this.service.deleteSession(id);
  }

  // ── 场次商品 ─────────────────────────────────────────────────────

  /** GET /v1/admin/flash-sale/sessions/:id/products */
  @Get('sessions/:id/products')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR, Role.VIEWER)
  getSessionProducts(@Param('id') sessionId: string) {
    return this.service.getSessionProducts(sessionId);
  }

  /** POST /v1/admin/flash-sale/sessions/:id/products */
  @Post('sessions/:id/products')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR)
  bindProduct(
    @Param('id') sessionId: string,
    @Body() dto: BindFlashSaleProductDto,
  ) {
    return this.service.bindProduct(sessionId, dto);
  }

  /** PATCH /v1/admin/flash-sale/products/:productId */
  @Patch('products/:productId')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR)
  updateProduct(
    @Param('productId') productId: string,
    @Body() dto: UpdateFlashSaleProductDto,
  ) {
    return this.service.updateProduct(productId, dto);
  }

  /** DELETE /v1/admin/flash-sale/products/:productId */
  @Delete('products/:productId')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  removeProduct(@Param('productId') productId: string) {
    return this.service.removeProduct(productId);
  }
}
