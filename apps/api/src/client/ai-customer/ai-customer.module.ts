import { Module, OnApplicationBootstrap, Logger } from '@nestjs/common';
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
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { createFlowTools } from '@api/client/ai-customer/graph/tools/flow-tools';

/**
 * 中心化注册表：在此添加新的 agent tag。
 * 当新增一个 domain agent（如 kycAgent）时，将对应的 tag 加入此数组。
 * AiCustomerModule.onApplicationBootstrap() 会验证所有期望的 tag 都已注册工具。
 */
const EXPECTED_AGENT_TAGS = ['order', 'wallet', 'coupon', 'flow', 'user'];

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
export class AiCustomerModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(AiCustomerModule.name);

  constructor(private readonly toolRegistry: ToolRegistryService) {}

  /**
   * 所有 domain module 的 OnApplicationBootstrap 已执行完毕（工具已注册），
   * 此时验证各 agent tag 是否都有对应的工具。
   */
  onApplicationBootstrap() {
    // 注册内部 flow 工具（不依赖外部服务）
    this.toolRegistry.registerMany(createFlowTools());
    this.logger.log('✅ Flow tools registered');

    this.toolRegistry.validateRegistration(EXPECTED_AGENT_TAGS, {
      error: (msg: string) => this.logger.error(msg),
      log: (msg: string) => this.logger.log(msg),
    });
  }
}
