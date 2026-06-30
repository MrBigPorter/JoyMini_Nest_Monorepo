import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { WalletService } from '@api/client/wallet/wallet.service';
import { WalletController } from '@api/client/wallet/wallet.controller';
import { ClientWalletService } from '@api/client/wallet/client-wallet.service';
import { PaymentWebhookController } from '@api/client/wallet/payment-webhook.controller';
import { PaymentChannelService } from '@api/common/payment-channel/payment-channel.service';
import { KycModule } from '@api/client/kyc/kyc.module';
import { KycService } from '@api/client/kyc/kyc.service';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { createWalletTools } from '@api/client/ai-customer/graph/tools/wallet-tools';
import { OtpService } from '@api/client/otp/otp.service';
import { OtpModule } from '@api/client/otp/otp.module';

@Module({
  imports: [KycModule, OtpModule],
  providers: [WalletService, ClientWalletService, PaymentChannelService],
  controllers: [WalletController, PaymentWebhookController],
  exports: [WalletService, ClientWalletService],
})
export class WalletModule implements OnApplicationBootstrap {
  constructor(
    private readonly walletService: WalletService,
    private readonly clientWalletService: ClientWalletService,
    private readonly kycService: KycService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly paymentChannelService: PaymentChannelService,
    private readonly otpService: OtpService,
  ) {}

  /**
   * 在应用程序启动时注册钱包相关的工具到工具注册表中。
   * 这些工具可以用于 AI 客户端的图形接口，提供钱包相关的功能。
   */
  onApplicationBootstrap() {
    const tools = createWalletTools(
      this.walletService,
      this.clientWalletService,
      this.kycService,
      this.paymentChannelService,
      this.otpService,
    );
    this.toolRegistry.registerMany(tools);
  }
}
