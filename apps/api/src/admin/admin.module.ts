import { Module } from '@nestjs/common';
import { AuthModule } from '@api/admin/auth/auth.module';
import { UserModule } from '@api/admin/user/user.module';
import { CategoryModule } from '@api/admin/category/category.module';
import { TreasureModule } from '@api/admin/treasure/treasure.module';
import { ActSectionModule } from '@api/admin/act-section/act-section.module';
import { BannerModule } from '@api/admin/banner/banner.module';
import { OrderModule } from '@api/admin/order/order.module';
import { CouponModule } from '@api/admin/coupon/coupon.module';
import { FinanceModule } from '@api/admin/finance/finance.module';
import { KycModule } from '@api/admin/kyc/kyc.module';
import { AddressModule } from '@api/admin/address/address.module';
import { AdminRegionModule } from '@api/admin/region/admin-region.module';
import { ClientUserModule } from '@api/admin/client-user/client-user.module';
import { AdminPaymentChannelModule } from '@api/admin/payment-channel/payment-channel.module';
import { GroupAdminModule } from '@api/admin/group/groups.module';
import { StatsModule } from '@api/admin/stats/stats.module';
import { OperationLogModule } from '@api/admin/operation-log/operation-log.module';
import { AdminNotificationModule } from '@api/admin/notification/notification.module';
import { AdminChatModule } from '@api/admin/chat/admin-chat.module';
import { LoginLogModule } from '@api/admin/login-log/login-log.module';
import { SystemConfigModule } from '@api/admin/system-config/system-config.module';
import { AdsModule } from '@api/admin/ads/ads.module';
import { FlashSaleModule } from '@api/admin/flash-sale/flash-sale.module';
import { RegisterApplicationModule } from '@api/admin/register-application/register-application.module';
import { AdminLuckyDrawModule } from '@api/admin/lucky-draw/lucky-draw.module';
import { SupportChannelModule } from '@api/admin/support-channel/support-channel.module';
import { RagModule } from '@api/admin/rag/rag.module';
import { AiPromptModule } from '@api/admin/ai-prompt/ai-prompt.module';

@Module({
  imports: [
    AuthModule,
    UserModule,
    CategoryModule,
    TreasureModule,
    ActSectionModule,
    BannerModule,
    OrderModule,
    CouponModule,
    FinanceModule,
    KycModule,
    AddressModule,
    AdminRegionModule,
    ClientUserModule,
    AdminPaymentChannelModule,
    GroupAdminModule,
    StatsModule,
    OperationLogModule,
    AdminNotificationModule,
    AdminChatModule,
    LoginLogModule,
    SystemConfigModule,
    AdsModule,
    FlashSaleModule,
    RegisterApplicationModule,
    AdminLuckyDrawModule,
    SupportChannelModule,
    RagModule,
    AiPromptModule,
  ],
  providers: [],
  controllers: [],
})
export class AdminModule {}
