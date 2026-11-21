import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  renderMetrics,
  resetMetricsForTest,
} from '@api/common/metrics/metrics';
import { ClientWalletService } from './client-wallet.service';
import { ApplyWithdrawDto } from './dto/apply-withdraw.dto';

function makeService() {
  const prisma = {
    user: { findUnique: jest.fn(async () => ({ phone: '09990000000' })) },
    kycRecord: { findFirst: jest.fn(async () => ({ kycStatus: 2 })) },
  };
  const otp = { verify: jest.fn(async () => true) };
  const service = new ClientWalletService(
    {} as any, // paymentService
    prisma as any, // prismaService
    {} as any, // walletService
    {} as any, // withdrawSettlementService
    otp as any, // otpService
  );
  // 执行点单独 spy：这些用例只关心「什么时候调用唯一执行点」。
  const verified = jest
    .spyOn(service, 'applyWithdrawVerified')
    .mockResolvedValue({ withdrawId: 'w-1' } as any);
  return { service, prisma, otp, verified };
}

const baseDto = () =>
  plainToInstance(ApplyWithdrawDto, {
    amount: 500,
    channelId: 2,
    account: '09170000000',
    accountName: 'Ann',
  });

describe('ClientWalletService · 提现 OTP 强制化', () => {
  const original = process.env.WITHDRAW_OTP_ENFORCE;

  beforeEach(() => {
    resetMetricsForTest();
    delete process.env.WITHDRAW_OTP_ENFORCE;
  });

  afterAll(() => {
    if (original === undefined) delete process.env.WITHDRAW_OTP_ENFORCE;
    else process.env.WITHDRAW_OTP_ENFORCE = original;
  });

  it('开关开启且未携带 otpCode：拒绝，不调用执行点', async () => {
    process.env.WITHDRAW_OTP_ENFORCE = 'true';
    const { service, verified, otp } = makeService();

    await expect(service.applyWithdraw('u1', baseDto())).rejects.toThrow(
      'OTP code is required for withdrawal',
    );
    expect(otp.verify).not.toHaveBeenCalled();
    expect(verified).not.toHaveBeenCalled();
  });

  it('开关关闭且未携带 otpCode：放行旧调用但记录缺失指标', async () => {
    const { service, verified } = makeService();

    await service.applyWithdraw('u1', baseDto());

    expect(verified).toHaveBeenCalledTimes(1);
    expect(renderMetrics()).toContain('withdraw_otp_missing_total 1');
  });

  it('携带正确验证码：先验码再调用执行点', async () => {
    process.env.WITHDRAW_OTP_ENFORCE = 'true';
    const { service, verified, otp } = makeService();
    const dto = baseDto();
    dto.otpCode = '123456';

    await service.applyWithdraw('u1', dto);

    expect(otp.verify).toHaveBeenCalledWith({
      phone: '09990000000',
      codeType: expect.anything(),
      code: '123456',
    });
    expect(verified).toHaveBeenCalledWith('u1', dto);
    expect(otp.verify.mock.invocationCallOrder[0 as never]).toBeLessThan(
      verified.mock.invocationCallOrder[0 as never],
    );
  });

  it('错误/过期验证码：拒绝，不调用执行点', async () => {
    process.env.WITHDRAW_OTP_ENFORCE = 'true';
    const { service, verified, otp } = makeService();
    otp.verify.mockResolvedValueOnce(false);
    const dto = baseDto();
    dto.otpCode = '000000';

    await expect(service.applyWithdraw('u1', dto)).rejects.toThrow(
      'Invalid OTP code',
    );
    expect(verified).not.toHaveBeenCalled();
  });

  it('验证码重放：第二次校验失败后拒绝执行', async () => {
    process.env.WITHDRAW_OTP_ENFORCE = 'true';
    const { service, verified, otp } = makeService();
    otp.verify.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const dto = baseDto();
    dto.otpCode = '123456';

    await service.applyWithdraw('u1', dto);
    await expect(service.applyWithdraw('u1', dto)).rejects.toThrow(
      'Invalid OTP code',
    );

    expect(verified).toHaveBeenCalledTimes(1);
  });

  it('用户没有绑定手机号：拒绝验码', async () => {
    process.env.WITHDRAW_OTP_ENFORCE = 'true';
    const { service, prisma, verified } = makeService();
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(null);
    const dto = baseDto();
    dto.otpCode = '123456';

    await expect(service.applyWithdraw('u1', dto)).rejects.toThrow(
      BadRequestException,
    );
    expect(verified).not.toHaveBeenCalled();
  });
});

describe('ClientWalletService · 提现前置实名认证', () => {
  it('KYC 未通过：拒绝执行，不进入渠道校验', async () => {
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ phone: '09990000000' })) },
      kycRecord: { findFirst: jest.fn(async () => ({ kycStatus: 0 })) },
      paymentChannel: { findUnique: jest.fn() },
    };
    const service = new ClientWalletService(
      {} as any,
      prisma as any,
      {} as any,
      {} as any,
      { verify: jest.fn(async () => true) } as any,
    );

    await expect(
      service.applyWithdrawVerified('u1', baseDto()),
    ).rejects.toThrow('KYC not approved');
    expect(prisma.paymentChannel.findUnique).not.toHaveBeenCalled();
  });
});

describe('ApplyWithdrawDto · 禁止夹带卡号/CVV/密码', () => {
  it('未声明的敏感字段被 forbidNonWhitelisted 拒绝', async () => {
    const dto = plainToInstance(ApplyWithdrawDto, {
      amount: 500,
      channelId: 2,
      account: '09170000000',
      accountName: 'Ann',
      cardNumber: '4111111111111111',
      cvv: '123',
      password: 'secret',
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    const properties = errors.map((error) => error.property).sort();
    expect(properties).toEqual(['cardNumber', 'cvv', 'password']);
  });

  it('合法字段（含 otpCode）能通过校验', async () => {
    const dto = plainToInstance(ApplyWithdrawDto, {
      amount: 500,
      channelId: 2,
      account: '09170000000',
      accountName: 'Ann',
      otpCode: '123456',
    });

    await expect(
      validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
    ).resolves.toHaveLength(0);
  });
});
