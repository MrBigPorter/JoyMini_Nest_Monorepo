import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { PermissionsGuard } from '@api/common/guards/permissions.guard';
import { RequirePermission } from '@api/common/decorators/require-permission.decorator';
import { OpAction, OpModule } from '@lucky/shared';
import { QueryKycDto } from '@api/admin/kyc/dto/query-kyc.dto';
import { KycService } from '@api/admin/kyc/kyc.service';
import { plainToInstance } from 'class-transformer';
import { KycRecordResponseDto } from '@api/admin/kyc/dto/kyc-record.response.dto';
import { KycRecordListResponseDto } from '@api/admin/kyc/dto/kyc-record-list.response.dto';
import { AuditKycDto } from '@api/admin/kyc/dto/audit-kyc.dto';
import { CurrentUserId } from '@api/common/decorators/user.decorator';
import { RealIp } from '@api/common/decorators/http.decorators';
import { AdminCreateKycDto } from '@api/admin/kyc/dto/admin-create-kyc.dto';
import {
  maskSensitiveFields,
  maskName,
  maskIdCard,
  maskPhone,
} from '@api/common/utils/data-masking';

@ApiTags('Admin KYC Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/kyc')
export class KycController {
  constructor(private kycService: KycService) {}

  /**
   * Get KYC record list with pagination and filters
   * @param dto
   */
  @Get('records')
  @RequirePermission(OpModule.USER, OpAction.USER.VIEW)
  @ApiOkResponse({ type: KycRecordListResponseDto })
  async list(@Query() dto: QueryKycDto, @Req() req: Request) {
    const result = await this.kycService.getKycRecordList(dto);
    const response = {
      ...result,
      list: plainToInstance(KycRecordResponseDto, result.list, {
        excludeExtraneousValues: true,
      }),
    };
    return maskSensitiveFields(response, (req as any).user?.role, {
      realName: maskName,
      idNumber: maskIdCard,
      'user.nickname': maskName,
      'user.phone': maskPhone,
    });
  }

  /**
   * Get KYC record detail by ID
   * @param id
   */
  @Get('records/:id')
  @RequirePermission(OpModule.USER, OpAction.USER.VIEW)
  @ApiOkResponse({ type: KycRecordResponseDto })
  async getKycRecord(@Param('id') id: string, @Req() req: Request) {
    const record = await this.kycService.detail(id);
    const response = plainToInstance(KycRecordResponseDto, record, {
      excludeExtraneousValues: true,
    });
    return maskSensitiveFields(response, (req as any).user?.role, {
      realName: maskName,
      idNumber: maskIdCard,
      'user.nickname': maskName,
      'user.phone': maskPhone,
    });
  }

  /**
   * Audit KYC record
   * @param id
   * @param dto
   * @param userId
   * @param ip
   */
  @Post(':id/audit')
  @RequirePermission(OpModule.USER, OpAction.USER.KYC_AUDIT)
  @ApiOkResponse({ type: KycRecordResponseDto })
  async auditKyc(
    @Param('id') id: string,
    @Body() dto: AuditKycDto,
    @CurrentUserId() userId: string,
    @RealIp() ip: string,
  ) {
    const record = await this.kycService.adminAudit(id, dto, userId, ip);
    return plainToInstance(KycRecordResponseDto, record, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Update KYC information for a user
   * @param userId
   * @param dto
   * @param adminId
   * @param ip
   */
  @Put('update/:userId')
  @RequirePermission(OpModule.USER, OpAction.USER.UPDATE)
  @ApiOkResponse({ type: KycRecordResponseDto })
  async updateKycInfo(
    @Param('userId') userId: string,
    @Body() dto: AuditKycDto,
    @CurrentUserId() adminId: string,
    @RealIp() ip: string,
  ) {
    const record = await this.kycService.updateKycInfo(
      userId,
      dto,
      adminId,
      ip,
    );
    return plainToInstance(KycRecordResponseDto, record, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Revoke KYC approval for a user
   * @param userId
   * @param reason
   * @param adminId
   * @param ip
   */
  @Post('revoke/:userId')
  @RequirePermission(OpModule.USER, OpAction.USER.UPDATE)
  @ApiOkResponse({ type: KycRecordResponseDto })
  async revokeKyc(
    @Param('userId') userId: string,
    @Body('reason') reason: string,
    @CurrentUserId() adminId: string,
    @RealIp() ip: string,
  ) {
    const record = await this.kycService.revokeKyc(userId, reason, adminId, ip);
    return plainToInstance(KycRecordResponseDto, record, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Delete KYC record for a user
   * @param userId
   * @param adminId
   * @param ip
   */
  @Delete('delete/:userId')
  @RequirePermission(OpModule.USER, OpAction.USER.DELETE)
  @ApiOkResponse({ type: KycRecordResponseDto })
  async deleteKyc(
    @Param('userId') userId: string,
    @CurrentUserId() adminId: string,
    @RealIp() ip: string,
  ) {
    const record = await this.kycService.deleteKyc(userId, adminId, ip);
    return plainToInstance(KycRecordResponseDto, record, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Create a new KYC record for a user
   * @param dto
   * @param adminId
   * @param ip
   */
  @Post('create')
  @RequirePermission(OpModule.USER, OpAction.USER.CREATE)
  @ApiOkResponse({ type: KycRecordResponseDto })
  async create(
    @Body() dto: AdminCreateKycDto,
    @CurrentUserId() adminId: string,
    @RealIp() ip: string,
  ) {
    return this.kycService.createKycByAdmin(dto, adminId, ip);
  }
}
