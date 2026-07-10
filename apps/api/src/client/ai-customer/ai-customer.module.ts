import { Module, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { SseRateLimiterService } from '@api/client/ai-customer/sse-rate-limiter.service';
import { OrderModule } from '@api/client/orders/order.module';
import { WalletModule } from '@api/client/wallet/wallet.module';
import { TreasureModule } from '@api/client/treasure/treasure.module';
import { CategoryModule } from '@api/client/category/category.module';
import { AddressModule } from '@api/client/address/address.module';
import { GroupModule } from '@api/common/group/group.module';
import { LuckyDrawModule } from '@api/common/lucky-draw/lucky-draw.module';
import { KycModule } from '@api/client/kyc/kyc.module';
import { AuthModule } from '@api/client/auth/auth.module';
import { ClientCouponModule } from '@api/client/coupon/coupon.module';
import { ClientFlashSaleModule } from '@api/client/flash-sale/flash-sale.module';
import { AiCustomerService } from '@api/client/ai-customer/ai-customer.service';
import { RagRetrievalService } from '@api/client/ai-customer/knowledge/rag-retrieval.service';
import { PromptResolverService } from '@api/client/ai-customer/knowledge/prompt-resolver.service';
import { AiCustomerController } from '@api/client/ai-customer/ai-customer.controller';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { createFlowTools } from '@api/client/ai-customer/graph/tools/flow-tools';
import { createProductTools } from '@api/client/ai-customer/graph/tools/product-tools';
import { createLuckyTools } from '@api/client/ai-customer/graph/tools/lucky-tools';
import { createKycTools } from '@api/client/ai-customer/graph/tools/kyc-tools';
import { AGENT_TAGS_FOR_TOOLS } from '@api/client/ai-customer/graph/config/agent-tags';
import { LuckyDrawService } from '@api/common/lucky-draw/lucky-draw.service';
import { ClientFlashSaleService } from '@api/client/flash-sale/flash-sale.service';
import { KycService } from '@api/client/kyc/kyc.service';
import { TreasureService } from '@api/client/treasure/treasure.service';
import { CategoryService } from '@api/client/category/category.service';

/**
 * 需要工具注册的 Agent tag 列表。
 * 从 AGENT_BASE_MAP 自动推导，包含所有 type !== 'direct' 的 tag。
 * 新增 Agent 只需在 agent-tags.ts 加 1 行，无需手动更新此数组。
 *
 * 当前值: ['order', 'wallet', 'coupon', 'flow', 'user', 'product', 'lucky-draw', 'kyc']
 */
const EXPECTED_AGENT_TAGS = AGENT_TAGS_FOR_TOOLS;

@Module({
  imports: [
    OrderModule,
    WalletModule,
    TreasureModule,
    CategoryModule,
    AddressModule,
    GroupModule,
    LuckyDrawModule,
    KycModule,
    AuthModule,
    ClientCouponModule,
    ClientFlashSaleModule,
  ],
  controllers: [AiCustomerController],
  providers: [
    AiCustomerService,
    RagRetrievalService,
    PromptResolverService,
    SseRateLimiterService,
  ],
})
export class AiCustomerModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(AiCustomerModule.name);

  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly treasureService: TreasureService,
    private readonly categoryService: CategoryService,
    private readonly luckyDrawService: LuckyDrawService,
    private readonly flashSaleService: ClientFlashSaleService,
    private readonly kycService: KycService,
  ) {}

  /**
   * 所有 domain module 的 OnApplicationBootstrap 已执行完毕（工具已注册），
   * 此时验证各 agent tag 是否都有对应的工具。
   */
  onApplicationBootstrap() {
    // 注册内部 flow 工具（不依赖外部服务）
    this.toolRegistry.registerMany(createFlowTools());
    this.logger.log('✅ Flow tools registered');

    // 注册 product 工具（依赖 TreasureService + CategoryService）
    this.toolRegistry.registerMany(
      createProductTools(this.treasureService, this.categoryService),
    );
    this.logger.log('✅ Product tools registered');

    // 注册 lucky-draw + flash sale 工具（依赖 LuckyDrawService + ClientFlashSaleService）
    this.toolRegistry.registerMany(
      createLuckyTools(this.luckyDrawService, this.flashSaleService),
    );
    this.logger.log('✅ Lucky tools registered');

    // 注册 KYC 工具（依赖 KycService）
    this.toolRegistry.registerMany(createKycTools(this.kycService));
    this.logger.log('✅ KYC tools registered');

    this.toolRegistry.validateRegistration(EXPECTED_AGENT_TAGS, {
      error: (msg: string) => this.logger.error(msg),
      log: (msg: string) => this.logger.log(msg),
    });
  }
}
