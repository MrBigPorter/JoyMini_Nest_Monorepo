import { RegionService } from '@api/common/region/region.service';
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { ProvincesResponseDto } from '@api/admin/region/dto/provinces.response.dto';
import { plainToInstance } from 'class-transformer';
import { CitiesResponseDto } from '@api/admin/region/dto/cities.response.dto';
import { BarangaysResponseDto } from '@api/admin/region/dto/barangays.response.dto';
import { PermissionsGuard } from '@api/common/guards/permissions.guard';

@ApiTags('Admin Region')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/region')
export class AdminRegionController {
  constructor(private regionService: RegionService) {}

  /**
   * Get all provinces
   */
  @Get('provinces')
  @ApiOkResponse({ type: [ProvincesResponseDto] })
  async getProvinces() {
    const data = await this.regionService.getProvinces();
    return plainToInstance(ProvincesResponseDto, data);
  }

  /**
   * Get cities by province ID
   * @param provinceId
   */
  @Get('cities/:provinceId')
  @ApiOkResponse({ type: [CitiesResponseDto] })
  async getCities(@Param('provinceId') provinceId: number) {
    const data = await this.regionService.getCities(provinceId);
    return plainToInstance(CitiesResponseDto, data);
  }

  /**
   * Get barangays by city ID
   * @param cityId
   */
  @Get('barangays/:cityId')
  @ApiOkResponse({ type: [BarangaysResponseDto] })
  async getBarangays(@Param('cityId') cityId: number) {
    const data = await this.regionService.getBarangays(cityId);
    return plainToInstance(BarangaysResponseDto, data);
  }
}
