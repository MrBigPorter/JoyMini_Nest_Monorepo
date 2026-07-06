import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { ClientFlashSaleController } from './flash-sale.controller';
import { ClientFlashSaleService } from './flash-sale.service';

@Module({
  imports: [PrismaModule],
  controllers: [ClientFlashSaleController],
  providers: [ClientFlashSaleService],
  exports: [ClientFlashSaleService],
})
export class ClientFlashSaleModule {}
