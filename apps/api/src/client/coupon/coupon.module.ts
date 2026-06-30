import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { ClientCouponController } from '@api/client/coupon/coupon.controller';
import { ClientCouponService } from '@api/client/coupon/coupon.service';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { createCouponTools } from '@api/client/ai-customer/graph/tools/coupon-tools';

@Module({
  imports: [PrismaModule],
  controllers: [ClientCouponController],
  providers: [ClientCouponService],
  exports: [],
})
export class ClientCouponModule implements OnApplicationBootstrap {
  constructor(
    private readonly couponService: ClientCouponService,
    private readonly toolRegistry: ToolRegistryService,
  ) {}

  onApplicationBootstrap() {
    const tools = createCouponTools(this.couponService);
    this.toolRegistry.registerMany(tools);
  }
}
