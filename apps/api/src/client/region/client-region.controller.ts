import { RegionService } from '@api/common/region/region.service';
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { ProvincesResponseDto } from '@api/client/region/dto/provinces.response.dto';
import { plainToInstance } from 'class-transformer';
import { CitiesResponseDto } from '@api/client/region/dto/cities.response.dto';
import { BarangaysResponseDto } from '@api/client/region/dto/barangays.response.dto';

@ApiTags('Client Region')
@UseGuards(JwtAuthGuard)
@Controller('client/region')
export class ClientRegionController {
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
