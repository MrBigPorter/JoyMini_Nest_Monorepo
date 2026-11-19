import { Injectable, Logger, NotImplementedException } from '@nestjs/common';

/** 短信发送结果：供应商名 + 可选的受理状态/消息 ID，用于落库排查 */
export interface SmsSendResult {
  provider: string;
  messageId?: string;
  status?: string;
}

/** 短信发送能力：以后换供应商只改实现，OtpService 不动 */
export interface SmsProvider {
  send(phone: string, code: string): Promise<SmsSendResult>;
}

/** 开发环境：只打日志，不真发 */
@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger(ConsoleSmsProvider.name);

  async send(phone: string, code: string): Promise<SmsSendResult> {
    this.logger.log(`[DEV SMS] to ${phone}: code=${code}`);
    return { provider: 'console', status: 'logged' };
  }
}

/** 生产环境占位：账号没接入前，发送必须显式失败，不能假装成功 */
@Injectable()
export class UnconfiguredSmsProvider implements SmsProvider {
  async send(): Promise<SmsSendResult> {
    throw new NotImplementedException('SMS provider not configured');
  }
}
