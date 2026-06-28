import { Module } from '@nestjs/common';
import { OrderModule } from '@api/client/orders/order.module';
import { WalletModule } from '@api/client/wallet/wallet.module';
import { TreasureModule } from '@api/client/treasure/treasure.module';
import { AddressModule } from '@api/client/address/address.module';
import { GroupModule } from '@api/common/group/group.module';
import { LuckyDrawModule } from '@api/common/lucky-draw/lucky-draw.module';
import { KycModule } from '@api/client/kyc/kyc.module';
import { AuthModule } from '@api/client/auth/auth.module';
import { ClientCouponModule } from '@api/client/coupon/coupon.module';
import { FlashSaleModule } from '@api/admin/flash-sale/flash-sale.module';
import { AiCustomerService } from '@api/client/ai-customer/ai-customer.service';
import { AiCustomerController } from '@api/client/ai-customer/ai-customer.controller';

@Module({
  imports: [
    OrderModule,
    WalletModule,
    TreasureModule,
    AddressModule,
    GroupModule,
    LuckyDrawModule,
    KycModule,
    AuthModule,
    ClientCouponModule,
    FlashSaleModule,
  ],
  controllers: [AiCustomerController],
  providers: [AiCustomerService],
})
export class AiCustomerModule {}
