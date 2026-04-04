import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';
import { ORDER_STATUS } from '@lucky/shared';

/** Admin 可手动变更的订单状态集合 */
const ADMIN_SETTABLE_STATUSES = [
  ORDER_STATUS.CANCELED, // 4 — 取消
  ORDER_STATUS.REFUNDED, // 5 — 退款
  ORDER_STATUS.SHIPPED, // 8 — 已发货
  ORDER_STATUS.COMPLETED, // 9 — 已完成
] as const;

export type AdminSettableStatus = (typeof ADMIN_SETTABLE_STATUSES)[number];

export class UpdateOrderStatusDto {
  @ApiProperty({
    description: [
      'Admin-settable order status:',
      `  ${ORDER_STATUS.CANCELED}  = Cancelled`,
      `  ${ORDER_STATUS.REFUNDED}  = Refunded`,
      `  ${ORDER_STATUS.SHIPPED}   = Shipped`,
      `  ${ORDER_STATUS.COMPLETED} = Completed`,
    ].join('\n'),
    example: ORDER_STATUS.SHIPPED,
    enum: ADMIN_SETTABLE_STATUSES,
  })
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @IsIn(ADMIN_SETTABLE_STATUSES, {
    message: `Status must be one of: ${ADMIN_SETTABLE_STATUSES.join(', ')} (${[
      'Cancelled',
      'Refunded',
      'Shipped',
      'Completed',
    ].join(', ')})`,
  })
  status!: AdminSettableStatus;
}
