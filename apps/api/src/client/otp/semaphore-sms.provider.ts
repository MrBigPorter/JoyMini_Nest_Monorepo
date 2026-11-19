import {
  BadGatewayException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { SmsProvider, SmsSendResult } from './sms.provider';

export interface SemaphoreConfig {
  apiKey: string;
  senderName?: string;
  messageTemplate?: string;
  timeoutMs?: number;
}

interface SemaphoreMessage {
  message_id?: number | string;
  recipient?: string;
  status?: string;
}

/**
 * Semaphore（菲律宾）OTP 短信。
 *
 * 官方文档：POST https://api.semaphore.co/api/v4/otp
 * - apikey 放在 form 参数里，不是 Authorization header
 * - message 用 {otp} 占位，code 传我们自己的 6 位码
 * - 成功返回 JSON 数组；HTTP 200 只代表受理，status 可能是 Pending/Failed
 * - 错误 body 没有正式 schema，只能按 HTTP 状态分类
 */
export class SemaphoreSmsProvider implements SmsProvider {
  private readonly logger = new Logger(SemaphoreSmsProvider.name);
  private readonly endpoint = 'https://api.semaphore.co/api/v4/otp';
  private readonly apiKey: string;
  private readonly senderName?: string;
  private readonly messageTemplate: string;
  private readonly timeoutMs: number;

  constructor(config: SemaphoreConfig) {
    if (!config.apiKey) {
      throw new Error('SEMAPHORE_API_KEY is required');
    }
    this.apiKey = config.apiKey;
    this.senderName = config.senderName;
    this.messageTemplate =
      config.messageTemplate ??
      'Your JoyMini verification code is {otp}. Do not share it.';
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  async send(phone: string, code: string): Promise<SmsSendResult> {
    const number = this.normalizePhone(phone);
    const body = new URLSearchParams({
      apikey: this.apiKey,
      number,
      message: this.messageTemplate.replace('{otp}', code),
      code,
    });
    if (this.senderName) body.set('sendername', this.senderName);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: controller.signal,
      });

      if (res.status === 401 || res.status === 403) {
        this.logger.error('[semaphore] authentication failed');
        throw new ServiceUnavailableException('SMS provider authentication failed');
      }
      if (res.status === 429) {
        this.logger.warn('[semaphore] rate limited');
        throw new ServiceUnavailableException('SMS provider rate limited');
      }
      if (res.status >= 500) {
        this.logger.error(`[semaphore] provider error HTTP ${res.status}`);
        throw new ServiceUnavailableException('SMS provider unavailable');
      }
      if (!res.ok) {
        this.logger.error(`[semaphore] rejected HTTP ${res.status}`);
        throw new BadGatewayException('SMS provider rejected request');
      }

      const payload = (await res.json()) as SemaphoreMessage[];
      const first = Array.isArray(payload) ? payload[0] : undefined;
      if (!first) {
        this.logger.error('[semaphore] empty response');
        throw new BadGatewayException('SMS provider rejected request');
      }

      const status = String(first.status ?? '').toLowerCase();
      if (status === 'failed' || status === 'refunded') {
        this.logger.warn(
          `[semaphore] message ${first.message_id ?? 'unknown'} status=${first.status}`,
        );
        throw new ServiceUnavailableException('SMS provider could not deliver');
      }

      this.logger.log(
        `[semaphore] accepted message=${first.message_id ?? 'unknown'} ` +
          `status=${first.status ?? 'unknown'} to ${this.maskPhone(number)}`,
      );
      return {
        provider: 'semaphore',
        messageId: first.message_id != null ? String(first.message_id) : undefined,
        status: first.status,
      };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        this.logger.error('[semaphore] request timeout');
        throw new ServiceUnavailableException('SMS provider unavailable');
      }
      if (err instanceof ServiceUnavailableException || err instanceof BadGatewayException) {
        throw err;
      }
      this.logger.error(`[semaphore] network error: ${err?.message ?? err}`);
      throw new ServiceUnavailableException('SMS provider unavailable');
    } finally {
      clearTimeout(timer);
    }
  }

  /** 统一转成 Semaphore 接受的 639XXXXXXXXX；非法号码不发请求 */
  private normalizePhone(phone: string): string {
    const parsed = parsePhoneNumberFromString((phone ?? '').trim(), 'PH');
    if (!parsed || !parsed.isValid() || parsed.country !== 'PH') {
      throw new BadGatewayException('Invalid Philippines phone number');
    }
    return parsed.number.replace('+', '');
  }

  private maskPhone(phone: string): string {
    return phone.length > 4 ? `***${phone.slice(-4)}` : '***';
  }
}
