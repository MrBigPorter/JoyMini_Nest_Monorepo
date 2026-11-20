import { OtpService } from './otp.service';
import { isFixedOtpMode, resolveSmsProviderKind } from './sms.provider';

describe('SMS provider 选择', () => {
  it('未配置时：非生产用 console，生产用 unconfigured', () => {
    expect(resolveSmsProviderKind({ NODE_ENV: 'development' })).toBe('console');
    expect(resolveSmsProviderKind({ NODE_ENV: 'production' })).toBe(
      'unconfigured',
    );
  });

  it('OTP_PROVIDER=fixed → fixed（非生产）', () => {
    expect(
      resolveSmsProviderKind({
        NODE_ENV: 'development',
        OTP_PROVIDER: 'fixed',
      }),
    ).toBe('fixed');
    expect(
      isFixedOtpMode({
        NODE_ENV: 'development',
        OTP_PROVIDER: 'fixed',
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it('生产直接开 fixed → 启动失败（防止固定码误上线）', () => {
    expect(() =>
      resolveSmsProviderKind({
        NODE_ENV: 'production',
        OTP_PROVIDER: 'fixed',
      }),
    ).toThrow(/OTP_ALLOW_FIXED_IN_PROD/);
  });

  it('生产 fixed + 第二道确认 → 允许', () => {
    expect(
      resolveSmsProviderKind({
        NODE_ENV: 'production',
        OTP_PROVIDER: 'fixed',
        OTP_ALLOW_FIXED_IN_PROD: 'true',
      }),
    ).toBe('fixed');
  });
});

describe('OtpService · 固定验证码模式', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('OTP_PROVIDER=fixed 时用固定 code，并直接把 code 返回给调用方', async () => {
    const env = process.env as Record<string, string | undefined>;
    env.NODE_ENV = 'production';
    env.OTP_PROVIDER = 'fixed';
    env.OTP_ALLOW_FIXED_IN_PROD = 'true';
    env.OTP_FIXED_CODE = '999999';

    const prisma: any = {
      smsVerificationCode: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'r1' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const sms = { send: jest.fn().mockResolvedValue(undefined) };
    const service = new OtpService(prisma, sms as any);

    const result = await service.request({ phone: '13800138000' });

    expect(sms.send).toHaveBeenCalledWith('13800138000', '999999');
    expect(result).toEqual({ devCode: '999999', fixed: true });
  });
});
