import { CODE_TYPE, SEND_STATUS, VERIFY_STATUS } from '@lucky/shared';
import { OtpService } from './otp.service';

function makeService() {
  const prisma = {
    smsVerificationCode: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async () => ({ id: 'rec-1' })),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  };
  const sms = { send: jest.fn(async () => undefined) };
  return {
    service: new OtpService(prisma as any, sms as any),
    prisma,
    sms,
  };
}

describe('OtpService.request · 尝试预算', () => {
  it('请求新验证码前作废旧 PENDING，避免 5N 次猜测', async () => {
    const { service, prisma } = makeService();

    await service.request({ phone: '09171234567', codeType: CODE_TYPE.WITHDRAW });

    expect(prisma.smsVerificationCode.updateMany).toHaveBeenCalledWith({
      where: {
        phone: '09171234567',
        codeType: CODE_TYPE.WITHDRAW,
        verifyStatus: VERIFY_STATUS.PENDING,
      },
      data: { verifyStatus: VERIFY_STATUS.EXPIRED },
    });

    const expireAt =
      prisma.smsVerificationCode.updateMany.mock.invocationCallOrder[0];
    const createAt = prisma.smsVerificationCode.create.mock.invocationCallOrder[0];
    expect(expireAt).toBeLessThan(createAt);
  });

  it('发送失败时不把记录标成 SENT', async () => {
    const { service, prisma, sms } = makeService();
    sms.send.mockRejectedValueOnce(new Error('sms down'));

    await expect(
      service.request({ phone: '09171234567', codeType: CODE_TYPE.WITHDRAW }),
    ).rejects.toThrow('sms down');

    expect(prisma.smsVerificationCode.update).toHaveBeenCalledWith({
      where: { id: 'rec-1' },
      data: { sendStatus: SEND_STATUS.FAILED },
    });
  });
});
