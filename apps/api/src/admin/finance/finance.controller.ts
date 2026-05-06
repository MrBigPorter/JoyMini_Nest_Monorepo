import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { PermissionsGuard } from '@api/common/guards/permissions.guard';
import { FinanceService } from '@api/admin/finance/finance.service';
import { RequirePermission } from '@api/common/decorators/require-permission.decorator';
import { OpAction, OpModule } from '@lucky/shared';
import { QueryTransactionDto } from '@api/admin/finance/dto/query-transaction.dto';
import { ManualAdjustmentDto } from '@api/admin/finance/dto/manual-adjustment.dto';
import { CurrentUserId } from '@api/common/decorators/user.decorator';
import { AuditWithdrawDto } from '@api/admin/finance/dto/audit-withdraw.dto';
import { TransactionListResponseDto } from '@api/admin/finance/dto/transaction-list-response.dto';
import { plainToInstance } from 'class-transformer';
import { TransactionResponseDto } from '@api/admin/finance/dto/transaction-response.dto';
import { WithdrawListResponseDto } from '@api/admin/finance/dto/withdraw-list-response.dto';
import { RealIp } from '@api/common/decorators/http.decorators';
import { WithdrawResponseDto } from '@api/admin/finance/dto/withdraw-response.dto';
import { QueryWithdrawalsDto } from '@api/admin/finance/dto/query-withdrawals.dto';
import { RechargeListResponseDto } from '@api/admin/finance/dto/recharge-list-response.dto';
import { QueryRechargeOrdersDto } from '@api/admin/finance/dto/query-recharge-orders.dto';
import { RechargeResponseDto } from '@api/admin/finance/dto/recharge-response.dto';
import { QueryStatisticsDto } from '@api/admin/finance/dto/query-statistics.dto';
import { FinanceAdjustResponseDto } from '@api/admin/finance/dto/finance-adjust-response.dto';
import {
  maskSensitiveFields,
  maskName,
  maskPhone,
} from '@api/common/utils/data-masking';

@ApiTags('Admin Finance Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('transactions')
  @RequirePermission(OpModule.FINANCE, OpAction.FINANCE.VIEW)
  @ApiOkResponse({ type: TransactionListResponseDto })
  async getTransactions(
    @Query() dto: QueryTransactionDto,
    @Req() req: Request,
  ) {
    const data = await this.financeService.getTransactions(dto);
    const response = {
      total: data.total,
      page: dto.page,
      pageSize: dto.pageSize,
      list: plainToInstance(TransactionResponseDto, data.list, {
        excludeExtraneousValues: true,
      }),
    };
    return maskSensitiveFields(response, (req as any).user?.role, {
      'user.nickname': maskName,
      'user.phone': maskPhone,
    });
  }

  /**
   * Manual adjustment of user balance
   * @param dto
   * @param userId
   * @param ip
   */
  @Post('adjust')
  @RequirePermission(OpModule.FINANCE, OpAction.FINANCE.MANUAL_ADJUST)
  @ApiOkResponse({ type: FinanceAdjustResponseDto })
  async manualAdjust(
    @Body() dto: ManualAdjustmentDto,
    @CurrentUserId() userId: string,
    @RealIp() ip: string,
  ) {
    const data = await this.financeService.manualAdjust(dto, {
      adminId: userId,
      ip,
    });
    return plainToInstance(FinanceAdjustResponseDto, data, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Get withdrawal requests
   * @param dto
   */
  @Get('withdrawals')
  @RequirePermission(OpModule.FINANCE, OpAction.FINANCE.VIEW)
  @ApiOkResponse({ type: WithdrawListResponseDto })
  async getWithdrawals(@Query() dto: QueryWithdrawalsDto, @Req() req: Request) {
    const data = await this.financeService.getWithdrawals(dto);
    const list = plainToInstance(WithdrawResponseDto, data.list, {
      excludeExtraneousValues: true,
    });
    const response = {
      total: data.total,
      page: dto.page,
      pageSize: dto.pageSize,
      list: list,
    };
    return maskSensitiveFields(response, (req as any).user?.role, {
      'user.nickname': maskName,
      'user.phone': maskPhone,
    });
  }

  /**
   * Get recharge orders
   * @param dto
   */
  @Get('recharges')
  @RequirePermission(OpModule.FINANCE, OpAction.FINANCE.VIEW)
  @ApiOkResponse({ type: RechargeListResponseDto })
  async getRecharges(
    @Query() dto: QueryRechargeOrdersDto,
    @Req() req: Request,
  ) {
    const data = await this.financeService.recharges(dto);
    const list = plainToInstance(RechargeResponseDto, data.list, {
      excludeExtraneousValues: true,
    });
    const response = {
      total: data.total,
      page: dto.page,
      pageSize: dto.pageSize,
      list: list,
    };
    return maskSensitiveFields(response, (req as any).user?.role, {
      'user.nickname': maskName,
      'user.phone': maskPhone,
    });
  }

  /**
   * Audit withdrawal request
   * @param dto
   * @param userId
   */
  @Post('withdrawals/audit')
  @RequirePermission(OpModule.FINANCE, OpAction.FINANCE.WITHDRAW_AUDIT)
  @ApiOkResponse({ type: WithdrawResponseDto })
  async auditWithdrawal(
    @Body() dto: AuditWithdrawDto,
    @CurrentUserId() userId: string,
  ) {
    const data = await this.financeService.auditWithdraw(dto, userId);
    return plainToInstance(WithdrawResponseDto, data, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Get finance statistics
   */
  @Get('statistics')
  @RequirePermission(OpModule.FINANCE, OpAction.FINANCE.VIEW)
  @ApiOkResponse({ type: QueryStatisticsDto })
  async getStatistics() {
    return this.financeService.getStatistics();
  }

  /**
   * Sync recharge order status
   * @param id
   * @param userId
   */
  @Post('recharge/sync/:id')
  @RequirePermission(OpModule.FINANCE, OpAction.FINANCE.VIEW)
  async syncRecharge(@Param('id') id: string, @CurrentUserId() userId: string) {
    return this.financeService.syncRechargeStatus(id, userId);
  }
}
