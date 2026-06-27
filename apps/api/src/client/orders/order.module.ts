import { Module } from '@nestjs/common';
import { OrderService } from '@api/client/orders/order.service';
import { OrderController } from '@api/client/orders/order.controller';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { WalletModule } from '@api/client/wallet/wallet.module';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { GroupModule } from '@api/common/group/group.module';
import { LuckyDrawModule } from '@api/common/lucky-draw/lucky-draw.module';
import { createOrderTools } from '@api/client/ai-customer/graph/tools/order-tools';

@Module({
  imports: [PrismaModule, WalletModule, GroupModule, LuckyDrawModule],
  controllers: [OrderController],
  providers: [
    OrderService,
    PrismaService,
    //新增：multi:true provider
    {
      //provide: 'AI_TOOLS' — 告诉 NestJS "我要往 'AI_TOOLS' 这个篮子里放东西"
      provide: 'AI_TOOLS',
      //useFactory — NestJS 启动时自动执行这个函数，创建 order 的两个 tool
      useFactory: (orderService: OrderService) =>
        createOrderTools(orderService),
      //inject: [OrderService] — NestJS 自动把 OrderService 传给 useFactory
      inject: [OrderService],
      multi: true,
    } as any,
  ],
  //exports: ['AI_TOOLS'] — 必须导出，否则 AiCustomerModule 看不到篮子里的东西
  exports: [OrderService, 'AI_TOOLS'],
})
export class OrderModule {}
