import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
/** 短信发送能力：以后换供应商只改实现，OtpService 不动 */
export interface SmsProvider {
  send(phone: string, code: string): Promise<void>;
}

/** 开发环境：只打日志，不真发 */
@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger(ConsoleSmsProvider.name);

  async send(phone: string, code: string): Promise<void> {
    this.logger.log(`[DEV SMS] to ${phone}: code=${code}`);
  }
}

/** 生产环境占位：账号没接入前，发送必须显式失败，不能假装成功 */
@Injectable()
export class UnconfiguredSmsProvider implements SmsProvider {
  async send(): Promise<void> {
    throw new NotImplementedException('SMS provider not configured');
  }
}
