import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { PermissionsGuard } from '@api/common/guards/permissions.guard';
import { AddressService } from '@api/admin/address/address.service';
import {
  AdminAddressResponseDto,
  AdminQueryAddressDto,
  AdminUpdateAddressDto,
} from '@api/admin/address/dto/admin-address.dto';
import { plainToInstance } from 'class-transformer';
import { RequirePermission } from '@api/common/decorators/require-permission.decorator';
import { OpAction, OpModule } from '@lucky/shared';

@ApiTags('Admin Address')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/address')
export class AddressController {
  constructor(private readonly addressService: AddressService) {}

  /**
   *  admin get address list with filters
   * @param dto
   */
  @Get('list')
  @RequirePermission(OpModule.USER, OpAction.USER.VIEW)
  @ApiOkResponse({ type: AdminAddressResponseDto })
  async list(@Query() dto: AdminQueryAddressDto) {
    const data = await this.addressService.list(dto);
    return {
      ...data,
      list: plainToInstance(AdminAddressResponseDto, data.list),
    };
  }

  /**
   * Admin get address detail by id
   * @param id
   */
  @Get(':id')
  @RequirePermission(OpModule.USER, OpAction.USER.VIEW)
  @ApiOkResponse({ type: AdminAddressResponseDto })
  async getAddress(@Param('id') id: string) {
    const data = await this.addressService.detail(id);
    return plainToInstance(AdminAddressResponseDto, data);
  }

  /**
   * Admin update address by id
   * @param id
   * @param dto
   */
  @Post('update/:id')
  @RequirePermission(OpModule.USER, OpAction.USER.UPDATE)
  @ApiOkResponse({ type: AdminAddressResponseDto })
  async updateAddress(
    @Param('id') id: string,
    @Body() dto: AdminUpdateAddressDto,
  ) {
    const data = await this.addressService.update(id, dto);
    return plainToInstance(AdminAddressResponseDto, data);
  }

  /**
   * Admin delete address by id
   * @param id
   */
  @Delete('delete/:id')
  @RequirePermission(OpModule.USER, OpAction.USER.DELETE)
  async deleteAddress(@Param('id') id: string) {
    await this.addressService.delete(id);
  }
}
