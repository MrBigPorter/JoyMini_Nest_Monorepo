import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { AddressController } from '@api/client/address/address.controller';
import { AddressService } from '@api/client/address/address.service';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { RegionModule } from '@api/common/region/region.module';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { createUserTools } from '@api/client/ai-customer/graph/tools/user-tools';
import { AuthModule } from '@api/client/auth/auth.module';
import { AuthService } from '@api/client/auth/auth.service';

@Module({
  imports: [PrismaModule, RegionModule, AuthModule],
  controllers: [AddressController],
  providers: [AddressService],
  exports: [AddressService],
})
export class AddressModule implements OnApplicationBootstrap {
  constructor(
    private readonly authService: AuthService,
    private readonly addressService: AddressService,
    private readonly toolRegistry: ToolRegistryService,
  ) {}

  /**
   * 在应用程序启动时注册订单相关的工具到工具注册表中。
   * 这些工具可以用于 AI 客户端的图形接口，提供订单相关的功能。
   */
  onApplicationBootstrap() {
    const tools = createUserTools(this.authService, this.addressService);
    this.toolRegistry.registerMany(tools);
  }
}
