import {
  BadRequestException,
  Injectable,
  Inject,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { gen6Code } from '../../common/crypto.util';
import { addSeconds, isBefore } from 'date-fns';
import { throwBiz } from '@api/common/exceptions/biz.exception';
import { ERROR_KEYS } from '@api/common/error-codes.gen';
import { otpHash, verifyOtpHash } from '@api/common/otp.util';
import { CODE_TYPE, SEND_STATUS, VERIFY_STATUS } from '@lucky/shared';
import { SmsProvider } from './sms.provider';

const OTP_PEPPER = process.env.OTP_PEPPER || '';
const OTP_TTL_SECONDS = Number(process.env.OTP_TTL_SECONDS) || 300;
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS) || 5;
const OTP_INTERVAL_SECONDS = Number(process.env.OTP_INTERVAL_SECONDS) || 60;
const isDev = process.env.NODE_ENV === 'development';

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject('SMS_PROVIDER') private readonly sms: SmsProvider,
  ) {}

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
    const p = phone.trim();
    if (!p) throw new BadRequestException({ message: 'phone required' });

    // DB 限流：同手机号最近 OTP_INTERVAL_SECONDS 内只能申请一次
    const recent = await this.prisma.smsVerificationCode.findFirst({
      where: {
        phone: p,
        codeType: codeType,
        createdAt: { gte: new Date(Date.now() - OTP_INTERVAL_SECONDS * 1000) },
      },
      select: { id: true },
    });

    if (recent) {
      throwBiz(ERROR_KEYS.TOO_MANY_REQUESTS);
    }

    //开发环境固定验证码
    const code = isDev ? (process.env.OTP_DEV_CODE ?? '999999') : gen6Code();
    const codeHash = otpHash(p, code, OTP_PEPPER);
    const expiresAt = addSeconds(new Date(), OTP_TTL_SECONDS);

    // 入库（先记待发送，发送成功后再置 SENT）
    const record = await this.prisma.smsVerificationCode.create({
      data: {
        phone: p,
        codeType: codeType,
        codeHash: codeHash,
        sendStatus: SEND_STATUS.PENDING,
        verifyStatus: VERIFY_STATUS.PENDING,
        verifyTimes: 0,
        maxVerifyTimes: OTP_MAX_ATTEMPTS,
        expiresAt,
        requestIp: requestIp || null,
      },
    });

    try {
      await this.sms.send(p, code);
    } catch (err) {
      // 发送失败：如实记录，不假装成功
      await this.prisma.smsVerificationCode.update({
        where: { id: record.id },
        data: { sendStatus: SEND_STATUS.FAILED },
      });
      throw err;
    }

    await this.prisma.smsVerificationCode.update({
      where: { id: record.id },
      data: { sendStatus: SEND_STATUS.SENT },
    });

    if (isDev) {
      return { devCode: code };
    }

    // 生产环境的短信实现见 sms.provider.ts（当前为未配置占位，接入供应商后替换）
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
    const p = (phone || '').trim();
    const c = (code || '').trim();
    if (!p || !c) throw new BadRequestException('phone required');

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
    if (req.verifyTimes >= OTP_MAX_ATTEMPTS) {
      await this.prisma.smsVerificationCode.update({
        where: { id: req.id, verifyStatus: VERIFY_STATUS.PENDING },
        data: { verifyStatus: VERIFY_STATUS.LOCKED },
      });
      throwBiz(ERROR_KEYS.TOO_MANY_OTP_ATTEMPTS);
    }

    //比对验证码
    const isMatch = verifyOtpHash(p, c, req.codeHash, OTP_PEPPER);

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
      if (req.verifyTimes + 1 >= OTP_MAX_ATTEMPTS) {
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
