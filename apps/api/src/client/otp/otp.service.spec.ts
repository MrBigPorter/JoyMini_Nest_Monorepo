import { SEND_STATUS, VERIFY_STATUS } from '@lucky/shared';
import { otpHash } from '@api/common/otp.util';
import { OtpService } from './otp.service';

const PEPPER = 'p'.repeat(32);
const PHONE = '+639171234567';

function build(overrides: {
  send?: jest.Mock;
  create?: jest.Mock;
  update?: jest.Mock;
  findFirst?: jest.Mock;
  updateMany?: jest.Mock;
} = {}) {
  const prisma: any = {
    smsVerificationCode: {
      findFirst: overrides.findFirst ?? jest.fn().mockResolvedValue(null),
      create:
        overrides.create ??
        jest.fn().mockResolvedValue({ id: 'otp-1' }),
      update: overrides.update ?? jest.fn().mockResolvedValue({}),
      updateMany:
        overrides.updateMany ?? jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const config: any = {
    get: jest.fn((key: string, fallback?: any) => {
      const values: Record<string, any> = {
        NODE_ENV: 'production',
        OTP_PEPPER: PEPPER,
        OTP_TTL_SECONDS: '300',
        OTP_MAX_ATTEMPTS: '5',
        OTP_INTERVAL_SECONDS: '60',
      };
      return values[key] ?? fallback;
    }),
  };
  const sms = {
    send:
      overrides.send ??
      jest
        .fn()
        .mockResolvedValue({
          provider: 'semaphore',
          messageId: '12345',
          status: 'Pending',
        }),
  };
  return {
    service: new OtpService(prisma, config, sms as any),
    prisma,
    sms,
    config,
  };
}

describe('OtpService · 真实供应商接入', () => {
  it('发送成功：手机号归一化，写入 provider/messageId/status', async () => {
    const { service, prisma, sms } = build();

    const result = await service.request({ phone: '09171234567' });

    expect(result).toBe(true);
    expect(sms.send).toHaveBeenCalledWith(PHONE, expect.any(String));
    expect(prisma.smsVerificationCode.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ phone: PHONE }),
      }),
    );
    expect(prisma.smsVerificationCode.update).toHaveBeenCalledWith({
      where: { id: 'otp-1' },
      data: {
        sendStatus: SEND_STATUS.SENT,
        smsProvider: 'semaphore',
        smsMessageId: '12345',
        sendResult: 'Pending',
      },
    });
  });

  it('发送失败：写 FAILED 并原样抛出', async () => {
    const { service, prisma } = build({
      send: jest.fn().mockRejectedValue(new Error('provider down')),
    });

    await expect(service.request({ phone: '09171234567' })).rejects.toThrow(
      'provider down',
    );
    expect(prisma.smsVerificationCode.update).toHaveBeenCalledWith({
      where: { id: 'otp-1' },
      data: {
        sendStatus: SEND_STATUS.FAILED,
        sendResult: 'provider down',
      },
    });
  });

  it('限流查询排除 FAILED，供应商失败后可立即重试', async () => {
    const { service, prisma } = build();

    await service.request({ phone: '09171234567' });

    const where = prisma.smsVerificationCode.findFirst.mock.calls[0][0].where;
    expect(where.sendStatus).toEqual({ not: SEND_STATUS.FAILED });
  });

  it('校验成功：返回 9999', async () => {
    const { service, prisma } = build({
      findFirst: jest.fn().mockResolvedValue({
        id: 'otp-1',
        codeHash: otpHash(PHONE, '123456', PEPPER),
        verifyStatus: VERIFY_STATUS.PENDING,
        verifyTimes: 0,
        maxVerifyTimes: 5,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    });

    const result = await service.verify({
      phone: '09171234567',
      code: '123456',
    });

    expect(result).toBe('9999');
    expect(prisma.smsVerificationCode.updateMany).toHaveBeenCalled();
  });
});
