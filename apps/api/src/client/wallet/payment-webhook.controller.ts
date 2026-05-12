import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PaymentService } from '@api/common/payment/payment.service';
import { ClientWalletService } from '@api/client/wallet/client-wallet.service';

@ApiTags('Payment Webhook')
@Controller('payment')
export class PaymentWebhookController {
  private logger = new Logger(PaymentWebhookController.name);

  constructor(
    private paymentService: PaymentService,
    private clientWalletService: ClientWalletService,
  ) {}
  @Post('webhook/:channel')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Param('channel') channel: string,
    @Body() payload: any, //防止网关增加字段导致 DTO 校验失败 (400 Bad Request)
    @Headers('x-callback-token') token: string,
  ) {
    // 诊断日志 1: 记录请求到达
    const payloadType =
      payload && typeof payload === 'object'
        ? Object.keys(payload).join(', ')
        : typeof payload;
    this.logger.log(
      `[Webhook Entry] channel=${channel}, token_present=${!!token}, payload_keys=[${payloadType}]`,
    );

    // xendit webhook handling
    if (channel === 'xendit') {
      // check token validity
      if (!this.paymentService.verifyCallbackToken(token)) {
        this.logger.warn(
          `[Webhook Entry] Callback token verification FAILED (token=${token ? token.substring(0, 8) + '...' : 'EMPTY'})`,
        );
        throw new UnauthorizedException('Invalid callback token');
      }

      // 诊断日志 2: Token 验证通过，记录完整 payload 结构
      this.logger.log(
        `[Webhook Entry] Token OK, forwarding payload to handleUniversalWebhook`,
      );

      // 2. 业务处理
      // 注意：目前只处理了充值。如果后续做提现，可以在这里判断
      // 比如检查 payload.status 是 'COMPLETED' (提现) 还是 'PAID' (充值)
      await this.clientWalletService.handleUniversalWebhook(payload);
    }

    // Respond with OK status

    return { status: 'OK' };
  }
}
