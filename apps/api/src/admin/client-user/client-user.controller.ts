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
import { ClientUserService } from '@api/admin/client-user/client-user.service';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { PermissionsGuard } from '@api/common/guards/permissions.guard';
import {
  BanDeviceDto,
  ClientUserDetailVo,
  ClientUserDeviceVo,
  ClientUserListItemVo,
  ClientUserListResultVo,
  QueryClientUserDto,
  UpdateUserStatusDto,
} from '@api/admin/client-user/dto/client-user.dto';
import { RequirePermission } from '@api/common/decorators/require-permission.decorator';
import { OpAction, OpModule } from '@lucky/shared';
import { CurrentUserId } from '@api/common/decorators/user.decorator';
import { plainToInstance } from 'class-transformer';
import {
  maskSensitiveFields,
  maskName,
  maskPhone,
} from '@api/common/utils/data-masking';

@ApiTags('admin/client-user')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/client-user')
export class ClientUserController {
  constructor(private readonly clientUserService: ClientUserService) {}

  /**
   * 查询用户列表
   * @param dto
   */
  @Get('list')
  @RequirePermission(OpModule.USER, OpAction.USER.VIEW)
  @ApiOkResponse({ type: ClientUserListResultVo })
  async findAll(@Query() dto: QueryClientUserDto, @Req() req: Request) {
    const data = await this.clientUserService.findAll(dto);
    const result = {
      ...data,
      list: plainToInstance(ClientUserListItemVo, data.list),
    };
    return maskSensitiveFields(result, (req as any).user?.role, {
      nickname: maskName,
      phone: maskPhone,
    });
  }

  /**
   * 获取用户详情
   * @param id
   */
  @Get(':id')
  @RequirePermission(OpModule.USER, OpAction.USER.VIEW)
  @ApiOkResponse({ type: ClientUserDetailVo })
  async findOne(@Param('id') id: string, @Req() req: Request) {
    const data = await this.clientUserService.findOne(id);
    const result = plainToInstance(ClientUserDetailVo, data);
    return maskSensitiveFields(result, (req as any).user?.role, {
      nickname: maskName,
      phone: maskPhone,
    });
  }

  /**
   * 更新用户状态
   * @param dto
   * @param id
   */
  @Patch(':id/status')
  @RequirePermission(OpModule.USER, OpAction.USER.UPDATE)
  async updateStatus(
    @Body() dto: UpdateUserStatusDto,
    @Param('id') id: string,
  ) {
    return this.clientUserService.updateUserStatus(id, dto);
  }

  /**
   * 获取用户设备列表
   * @param id
   */
  @Get(':id/devices')
  @ApiOkResponse({ type: ClientUserDeviceVo })
  @RequirePermission(OpModule.USER, OpAction.USER.VIEW)
  async getUserDevices(@Param('id') id: string) {
    const data = await this.clientUserService.getUserDevices(id);
    return plainToInstance(ClientUserDeviceVo, data);
  }

  /**
   * 封禁设备
   * @param dto
   * @param adminId
   */
  @Post('device/ban')
  banDevice(@Body() dto: BanDeviceDto, @CurrentUserId() adminId: string) {
    return this.clientUserService.banDevice(dto, adminId);
  }

  /**
   * 解封设备
   * @param deviceId
   */
  @Delete('device/unban/:deviceId')
  unbanDevice(@Param('deviceId') deviceId: string) {
    return this.clientUserService.unbanDevice(deviceId);
  }
}
