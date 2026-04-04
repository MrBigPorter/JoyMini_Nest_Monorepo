import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { ClientFlashSaleService } from './flash-sale.service';
import {
  FlashSaleProductDetailResponseDto,
  FlashSaleSessionListResponseDto,
  FlashSaleSessionProductsResponseDto,
} from './dto/flash-sale-response.dto';

@ApiTags('Client Flash Sale')
@Controller('flash-sale')
export class ClientFlashSaleController {
  constructor(private readonly service: ClientFlashSaleService) {}

  @Get('sessions/active')
  @ApiOkResponse({ type: FlashSaleSessionListResponseDto })
  async getActiveSessions() {
    const data = await this.service.getActiveSessions();
    return plainToInstance(FlashSaleSessionListResponseDto, data);
  }

  @Get('sessions/:id/products')
  @ApiOkResponse({ type: FlashSaleSessionProductsResponseDto })
  async getSessionProducts(@Param('id') id: string) {
    const data = await this.service.getSessionProducts(id);
    return plainToInstance(FlashSaleSessionProductsResponseDto, data);
  }

  @Get('products/:id')
  @ApiOkResponse({ type: FlashSaleProductDetailResponseDto })
  async getProductDetail(@Param('id') id: string) {
    const data = await this.service.getProductDetail(id);
    return plainToInstance(FlashSaleProductDetailResponseDto, data);
  }
}
