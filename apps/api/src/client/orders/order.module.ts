import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { OrderService } from '@api/client/orders/order.service';
import { OrderController } from '@api/client/orders/order.controller';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { WalletModule } from '@api/client/wallet/wallet.module';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { GroupModule } from '@api/common/group/group.module';
import { LuckyDrawModule } from '@api/common/lucky-draw/lucky-draw.module';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { createOrderTools } from '@api/client/ai-customer/graph/tools/order-tools';

@Module({
  imports: [PrismaModule, WalletModule, GroupModule, LuckyDrawModule],
  controllers: [OrderController],
  providers: [OrderService, PrismaService],
  exports: [OrderService],
})
export class OrderModule implements OnApplicationBootstrap {
  constructor(
    private readonly orderService: OrderService,
    private readonly toolRegistry: ToolRegistryService,
  ) {}

  /**
   * 在应用程序启动时注册订单相关的工具到工具注册表中。
   * 这些工具可以用于 AI 客户端的图形接口，提供订单相关的功能。
   */
  onApplicationBootstrap() {
    const tools = createOrderTools(this.orderService);
    this.toolRegistry.registerMany(tools);
  }
}
