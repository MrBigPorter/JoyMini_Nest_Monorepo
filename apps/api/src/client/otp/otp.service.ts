import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { gen6Code } from '../../common/crypto.util';
import { addSeconds, isBefore } from 'date-fns';
import { throwBiz } from '@api/common/exceptions/biz.exception';
import { ERROR_KEYS } from '@api/common/error-codes.gen';
import { otpHash, verifyOtpHash } from '@api/common/otp.util';
import { CODE_TYPE, SEND_STATUS, VERIFY_STATUS } from '@lucky/shared';

const OTP_PEPPER = process.env.OTP_PEPPER || '';
const OTP_TTL_SECONDS = Number(process.env.OTP_TTL_SECONDS) || 300;
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS) || 5;
const OTP_INTERVAL_SECONDS = Number(process.env.OTP_INTERVAL_SECONDS) || 60;
const isProd = process.env.NODE_ENV === 'production';

@Injectable()
export class OtpService {
  constructor(private readonly prisma: PrismaService) {}

  // 仅开发环境：打印验证码；以后可接供应商 SDK
  private async sendSmsDev(phone: string, code: string) {
    console.log(`[DEV SMS] to ${phone}: code=${code}`);
    return code;
  }

  // 1) 请求验证码
  async request({ phone }: { phone: string }) {
    const p = phone.trim();
    if (!p) throw new BadRequestException({ message: 'phone required' });

    // DB 限流：同手机号最近 OTP_INTERVAL_SECONDS 内只能申请一次
    const recent = await this.prisma.smsVerificationCode.findFirst({
      where: {
        phone: p,
        codeType: CODE_TYPE.LOGIN,
        createdAt: { gte: new Date(Date.now() - OTP_INTERVAL_SECONDS * 1000) },
      },
      select: { id: true },
    });

    if (recent) {
      throwBiz(ERROR_KEYS.TOO_MANY_REQUESTS);
    }

    //开发环境固定验证码
    const code = isProd ? gen6Code() : (process.env.OTP_DEV_CODE ?? '999999');
    const codeHash = otpHash(p, code, OTP_PEPPER);
    const expiresAt = addSeconds(new Date(), OTP_TTL_SECONDS);

    // 入库（purpose=LOGIN）
    await this.prisma.smsVerificationCode.create({
      data: {
        phone: p,
        codeType: CODE_TYPE.LOGIN,
        codeHash: codeHash,
        sendStatus: SEND_STATUS.SENT,
        verifyStatus: VERIFY_STATUS.PENDING,
        verifyTimes: 0,
        maxVerifyTimes: OTP_MAX_ATTEMPTS,
        expiresAt,
        requestIp: null,
      },
    });

    console.log(`[OTP]==> to ${p}: code=${code}`);
    if (!isProd) {
      await this.sendSmsDev(p, code);
      return { devCode: code };
    }

    // TODO: 生产环境在这里调用供应商 SDK 发送短信
    return true;
  }

  // 2) 校验验证码（仅校验，不发 token）
  async verify({ phone, code }: { phone: string; code: string }) {
    const p = (phone || '').trim();
    const c = (code || '').trim();
    if (!p || !c) throw new BadRequestException('phone required');

    // 找最近一条待验证的登录验证码
    const req = await this.prisma.smsVerificationCode.findFirst({
      where: {
        phone,
        codeType: CODE_TYPE.LOGIN,
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

    // 记录尝试次数
    await this.prisma.smsVerificationCode.update({
      where: { id: req.id },
      data: {
        verifiedAt: isMatch ? new Date() : req.verifiedAt,
        verifyTimes: { increment: 1 }, // 计一次尝试（成功/失败都+1）
      },
    });

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
