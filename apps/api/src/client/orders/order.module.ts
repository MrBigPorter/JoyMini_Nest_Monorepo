import { Module } from '@nestjs/common';
import { OrderService } from '@api/client/orders/order.service';
import { OrderController } from '@api/client/orders/order.controller';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { WalletModule } from '@api/client/wallet/wallet.module';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { GroupModule } from '@api/common/group/group.module';
import { LuckyDrawModule } from '@api/common/lucky-draw/lucky-draw.module';

@Module({
  imports: [PrismaModule, WalletModule, GroupModule, LuckyDrawModule],
  controllers: [OrderController],
  providers: [OrderService, PrismaService],
  exports: [OrderService],
})
export class OrderModule {}
