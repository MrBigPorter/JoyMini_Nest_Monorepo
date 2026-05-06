import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { PermissionsGuard } from '@api/common/guards/permissions.guard';
import { OrderService } from '@api/admin/order/order.service';
import { OpAction, OpModule } from '@lucky/shared';
import { QueryOrderDto } from '@api/admin/order/dto/query-order.dto';
import { OrderResponseDto } from '@api/admin/order/dto/order-response.dto';
import { plainToInstance } from 'class-transformer';
import { PaginatedResponseDto } from '@api/common/dto/paginated-response.dto';
import { UpdateOrderStatusDto } from '@api/admin/order/dto/update-order-status.dto';
import 'reflect-metadata';
import { RequirePermission } from '@api/common/decorators/require-permission.decorator';
import { CurrentUserId } from '@api/common/decorators/user.decorator';
import { RefundAuditDto } from '@api/admin/order/dto/refund-audit.dto';
import { RefundResponseAdminDto } from '@api/admin/order/dto/refund-response.admin.dto';
import {
  maskSensitiveFields,
  maskName,
  maskPhone,
} from '@api/common/utils/data-masking';

@ApiTags('Admin Order Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/order')
export class OrderController {
  constructor(private readonly OrderService: OrderService) {}

  /**
   * Get a paginated list of orders with optional filters
   * @param query
   * @returns Paginated list of orders
   *
   */
  @Get('list')
  @RequirePermission(OpModule.ORDER, OpAction.ORDER.VIEW)
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiExtraModels(PaginatedResponseDto, OrderResponseDto)
  async findAll(@Query() query: QueryOrderDto, @Req() req: Request) {
    const result = await this.OrderService.findAll(query);

    const response = {
      ...result,
      list: plainToInstance(OrderResponseDto, result.list, {
        excludeExtraneousValues: true,
      }),
    };
    return maskSensitiveFields(response, (req as any).user?.role, {
      'user.nickname': maskName,
      'user.phone': maskPhone,
    });
  }

  /**
   * Get order details by ID
   * @param id
   * @returns Order details
   */
  @Get(':id')
  @RequirePermission(OpModule.ORDER, OpAction.ORDER.VIEW)
  @ApiOkResponse({ type: OrderResponseDto })
  async findOne(@Param('id') id: string, @Req() req: Request) {
    const order = await this.OrderService.finOne(id);
    const response = plainToInstance(OrderResponseDto, order, {
      excludeExtraneousValues: true,
    });
    return maskSensitiveFields(response, (req as any).user?.role, {
      'user.nickname': maskName,
      'user.phone': maskPhone,
    });
  }

  /**
   * Update order status
   * @param id
   * @param dto
   * @returns Updated order
   */
  @Patch(':id/status')
  @RequirePermission(OpModule.ORDER, OpAction.ORDER.UPDATE)
  @ApiOkResponse({ type: OrderResponseDto })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    const order = await this.OrderService.updateStatus(id, dto.status);
    return plainToInstance(OrderResponseDto, order, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Delete an order by ID
   * @param id
   * @return Deleted order
   */
  @Delete(':id')
  @RequirePermission(OpModule.ORDER, OpAction.ORDER.DELETE)
  async remove(@Param('id') id: string) {
    return this.OrderService.remove(id);
  }

  /**
   * Approve a refund request for an order
   * @param orderId
   * @param adminId
   * @returns Updated order with refund approved
   */
  @Post('refund/approve')
  @RequirePermission(OpModule.ORDER, OpAction.ORDER.UPDATE)
  @ApiOkResponse({ type: RefundResponseAdminDto })
  async approveRefund(
    @Body('orderId') orderId: string,
    @CurrentUserId() adminId: string,
  ) {
    const data = await this.OrderService.approveRefundByAdmin(adminId, orderId);
    return plainToInstance(RefundResponseAdminDto, data, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Reject a refund request for an order
   * @param dto
   * @param adminId
   * @returns Updated order with refund rejected
   */

  @Post('refund/reject')
  @RequirePermission(OpModule.ORDER, OpAction.ORDER.UPDATE)
  @ApiOkResponse({ type: RefundResponseAdminDto })
  async rejectRefund(
    @Body() dto: RefundAuditDto,
    @CurrentUserId() adminId: string,
  ) {
    const data = await this.OrderService.rejectRefundByAdmin(adminId, dto);
    return plainToInstance(RefundResponseAdminDto, data, {
      excludeExtraneousValues: true,
    });
  }
}
