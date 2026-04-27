import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

@Injectable()
export class OtpThrottlerGuard extends ThrottlerGuard {
  // @ts-ignore
  protected getTracker(req: Record<string, any>): string | string[] {
    const r = req as Request;

    const xff = r.headers['x-forwarded-for'];
    const xffStr = Array.isArray(xff) ? xff[0] : xff;

    const ip =
      normalizeIp(xffStr) ??
      normalizeIp(r.ip) ??
      normalizeIp(r.socket?.remoteAddress ?? null) ??
      'ip:unknown';

    const path = (r.originalUrl || r.url || '').toString();
    if (/\/(v\d+\/)?(otp\/|auth\/login\/otp)/.test(path)) {
      const phoneTail = String(r.body?.phone ?? r.query?.phone ?? '').slice(-6);
      // 用数组作为“组合键”：同一个请求会生成多个 key 更严格
      return [`ip:${ip}`, `p:${phoneTail}`];
    }
    return `ip:${ip}`;
  }
}

function normalizeIp(raw?: string | null) {
  if (!raw) return undefined;
  const first = raw.split(',')[0].trim();
  return first.replace(/^::ffff:/, '').replace(/:\d+$/, '');
}
