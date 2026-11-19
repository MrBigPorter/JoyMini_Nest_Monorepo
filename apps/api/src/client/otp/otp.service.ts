import {
  BadRequestException,
  Injectable,
  Inject,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { gen6Code } from '../../common/crypto.util';
import { addSeconds, isBefore } from 'date-fns';
import { throwBiz } from '@api/common/exceptions/biz.exception';
import { ERROR_KEYS } from '@api/common/error-codes.gen';
import { otpHash, verifyOtpHash } from '@api/common/otp.util';
import { CODE_TYPE, SEND_STATUS, VERIFY_STATUS } from '@lucky/shared';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { SmsProvider } from './sms.provider';

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject('SMS_PROVIDER') private readonly sms: SmsProvider,
  ) {}

  /** 统一在调用时读取，避免 .env 加载顺序导致 pepper 为空（#96 N-19） */
  private get pepper(): string {
    return this.config.get<string>('OTP_PEPPER') ?? '';
  }

  private get ttlSeconds(): number {
    return Number(this.config.get<string>('OTP_TTL_SECONDS')) || 300;
  }

  private get maxAttempts(): number {
    return Number(this.config.get<string>('OTP_MAX_ATTEMPTS')) || 5;
  }

  private get intervalSeconds(): number {
    return Number(this.config.get<string>('OTP_INTERVAL_SECONDS')) || 60;
  }

  private get isDev(): boolean {
    return (
      (this.config.get<string>('NODE_ENV') ?? process.env.NODE_ENV) ===
      'development'
    );
  }

  /** 统一存 E.164（+63...），与 auth.service 的查询口径一致 */
  private normalizePhone(phone: string): string {
    const parsed = parsePhoneNumberFromString((phone ?? '').trim(), 'PH');
    if (!parsed || !parsed.isValid() || parsed.country !== 'PH') {
      throw new BadRequestException('Invalid Philippines phone number');
    }
    return parsed.number;
  }

  // 1) 请求验证码
  async request({
    phone,
    codeType = CODE_TYPE.LOGIN,
    requestIp,
  }: {
    phone: string;
    codeType?: number;
    requestIp?: string;
  }) {
    const p = this.normalizePhone(phone);

    // DB 限流：同手机号最近 OTP_INTERVAL_SECONDS 内只能申请一次。
    // 排除 FAILED：供应商抖动导致发送失败时，用户应能立即重试。
    const recent = await this.prisma.smsVerificationCode.findFirst({
      where: {
        phone: p,
        codeType: codeType,
        sendStatus: { not: SEND_STATUS.FAILED },
        createdAt: {
          gte: new Date(Date.now() - this.intervalSeconds * 1000),
        },
      },
      select: { id: true },
    });

    if (recent) {
      throwBiz(ERROR_KEYS.TOO_MANY_REQUESTS);
    }

    //开发环境固定验证码
    const code = this.isDev
      ? (this.config.get<string>('OTP_DEV_CODE') ?? '999999')
      : gen6Code();
    const codeHash = otpHash(p, code, this.pepper);
    const expiresAt = addSeconds(new Date(), this.ttlSeconds);

    // 入库（先记待发送，发送成功后再置 SENT）
    const record = await this.prisma.smsVerificationCode.create({
      data: {
        phone: p,
        codeType: codeType,
        codeHash: codeHash,
        sendStatus: SEND_STATUS.PENDING,
        verifyStatus: VERIFY_STATUS.PENDING,
        verifyTimes: 0,
        maxVerifyTimes: this.maxAttempts,
        expiresAt,
        requestIp: requestIp || null,
      },
    });

    try {
      const result = await this.sms.send(p, code);
      await this.prisma.smsVerificationCode.update({
        where: { id: record.id },
        data: {
          sendStatus: SEND_STATUS.SENT,
          smsProvider: result.provider,
          smsMessageId: result.messageId ?? null,
          sendResult: result.status ?? null,
        },
      });
    } catch (err: any) {
      // 发送失败：如实记录，不假装成功
      await this.prisma.smsVerificationCode.update({
        where: { id: record.id },
        data: {
          sendStatus: SEND_STATUS.FAILED,
          sendResult: String(err?.message ?? 'unknown').slice(0, 200),
        },
      });
      throw err;
    }

    if (this.isDev) {
      return { devCode: code };
    }

    return true;
  }

  // 2) 校验验证码（仅校验，不发 token）
  async verify({
    phone,
    code,
    codeType = CODE_TYPE.LOGIN,
  }: {
    phone: string;
    code: string;
    codeType?: number;
  }) {
    const p = this.normalizePhone(phone);
    const c = (code || '').trim();
    if (!c) throw new BadRequestException('code required');

    // 找最近一条待验证的登录验证码
    const req = await this.prisma.smsVerificationCode.findFirst({
      where: {
        phone: p,
        codeType,
        verifyStatus: VERIFY_STATUS.PENDING,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!req) throw new BadRequestException('Otp not found');
    // 过期处理，标记为过期
    if (isBefore(req.expiresAt, new Date())) {
      await this.prisma.smsVerificationCode.update({
        where: { id: req.id },
        data: { verifyStatus: VERIFY_STATUS.EXPIRED },
      });
      throwBiz(ERROR_KEYS.OTP_EXPIRED);
    }
    if (req.verifyTimes >= this.maxAttempts) {
      await this.prisma.smsVerificationCode.update({
        where: { id: req.id, verifyStatus: VERIFY_STATUS.PENDING },
        data: { verifyStatus: VERIFY_STATUS.LOCKED },
      });
      throwBiz(ERROR_KEYS.TOO_MANY_OTP_ATTEMPTS);
    }

    //比对验证码
    const isMatch = verifyOtpHash(p, c, req.codeHash, this.pepper);

    // 原子更新：仍为 PENDING 且未达上限才+1；成功则置 VERIFIED 并写 verifiedAt
    const updated = await this.prisma.smsVerificationCode.updateMany({
      where: {
        id: req.id,
        verifyStatus: VERIFY_STATUS.PENDING,
        verifyTimes: { lt: req.maxVerifyTimes },
      },
      data: isMatch
        ? {
            verifyStatus: VERIFY_STATUS.VERIFIED,
            verifiedAt: new Date(),
            verifyTimes: { increment: 1 },
          }
        : {
            verifyTimes: { increment: 1 },
          },
    });

    // 并发下可能被别的请求先处理，这里兜底
    if (updated.count !== 1) {
      throwBiz(ERROR_KEYS.OTP_NOT_VERIFIED_OR_ALREADY_USED);
    }

    if (!isMatch) {
      if (req.verifyTimes + 1 >= this.maxAttempts) {
        await this.prisma.smsVerificationCode.updateMany({
          where: {
            id: req.id,
            verifyStatus: VERIFY_STATUS.PENDING,
          },
          data: {
            verifyStatus: VERIFY_STATUS.LOCKED,
          },
        });
      }
      throw new UnauthorizedException('Invalid code');
    }

    return '9999';
  }
}
