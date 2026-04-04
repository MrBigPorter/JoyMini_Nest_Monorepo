import { Module } from '@nestjs/common';
import { AuthModule } from '@api/client/auth/auth.module';
import { OtpModule } from '@api/client/otp/otp.module';
import { TreasureModule } from '@api/client/treasure/treasure.module';
import { CategoryModule } from '@api/client/category/category.module';
import { BannersModule } from '@api/client/banners/banners.module';
import { AdsModule } from '@api/client/ads/ads.module';
import { SectionsModule } from '@api/client/sections/sections.module';
import { GroupModule } from '@api/common/group/group.module';
import { WalletModule } from '@api/client/wallet/wallet.module';
import { OrderModule } from '@api/client/orders/order.module';
import { HealthController } from '@api/client/health/health.controller';
import { KycModule } from '@api/client/kyc/kyc.module';
import { AddressModule } from '@api/client/address/address.module';
import { ClientRegionModule } from '@api/client/region/client-region.module';
import { PaymentChannelClientModule } from '@api/client/payment-channel/payment-channel.module';
import { GroupClientModule } from '@api/client/group/groups.module';
import { UsersModule } from '@api/client/users/users.module';
import { NotificationModule } from '@api/client/notification/notification.module';
import { ClientCouponModule } from '@api/client/coupon/coupon.module';
import { ClientLuckyDrawModule } from '@api/client/lucky-draw/lucky-draw.module';
import { ClientFlashSaleModule } from '@api/client/flash-sale/flash-sale.module';
import { ClientSystemConfigModule } from './system-config/system-config.module';

@Module({
  imports: [
    AuthModule,
    OtpModule,
    TreasureModule,
    CategoryModule,
    BannersModule,
    AdsModule,
    SectionsModule,
    GroupModule,
    WalletModule,
    OrderModule,
    KycModule,
    AddressModule,
    ClientRegionModule,
    PaymentChannelClientModule,
    GroupClientModule,
    UsersModule,
    NotificationModule,
    ClientCouponModule,
    ClientLuckyDrawModule,
    ClientFlashSaleModule,
    ClientSystemConfigModule, // 新增：客户端系统配置模块
  ],
  providers: [],
  controllers: [HealthController],
})
export class ClientModule {}
