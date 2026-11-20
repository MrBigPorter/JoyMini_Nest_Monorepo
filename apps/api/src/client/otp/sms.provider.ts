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

/**
 * 固定验证码模式：不发真实短信，只打日志并让请求返回固定 code。
 *
 * 用途：没有短信供应商账号时跑通 OTP 全流程。
 * 生产环境默认禁止；必须同时设置 OTP_ALLOW_FIXED_IN_PROD=true 才允许，
 * 避免有人误把固定验证码带上线造成任意账号登录。
 */
@Injectable()
export class FixedSmsProvider implements SmsProvider {
  private readonly logger = new Logger(FixedSmsProvider.name);

  async send(phone: string, code: string): Promise<void> {
    this.logger.warn(`[FIXED SMS] to ${phone}: code=${code}`);
  }
}

/** 生产环境占位：账号没接入前，发送必须显式失败，不能假装成功 */
@Injectable()
export class UnconfiguredSmsProvider implements SmsProvider {
  async send(): Promise<void> {
    throw new NotImplementedException('SMS provider not configured');
  }
}

export type SmsProviderKind = 'fixed' | 'console' | 'unconfigured';

/** OTP 是否使用固定验证码（不生成随机码）。 */
export function isFixedOtpMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OTP_PROVIDER === 'fixed' || env.OTP_FIXED_MODE === 'true';
}

/**
 * 选择 SMS provider。
 *
 * fixed 需要显式开启；生产环境还要第二道确认，否则启动直接失败。
 * 非生产环境历史上就是 Console，保持默认行为不变。
 */
export function resolveSmsProviderKind(
  env: NodeJS.ProcessEnv = process.env,
): SmsProviderKind {
  const fixed = env.OTP_PROVIDER === 'fixed' || env.OTP_FIXED_MODE === 'true';
  const isProd = env.NODE_ENV === 'production';

  if (fixed && isProd && env.OTP_ALLOW_FIXED_IN_PROD !== 'true') {
    throw new Error(
      'OTP_PROVIDER=fixed is not allowed in production without OTP_ALLOW_FIXED_IN_PROD=true',
    );
  }
  if (fixed) return 'fixed';
  return isProd ? 'unconfigured' : 'console';
}
