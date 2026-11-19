import { AuthService } from './auth.service';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { BIND_STATUS } from '@lucky/shared';
import { otpHash } from '@api/common/otp.util';
import { EmailService } from '@api/common/email/email.service';

describe('AuthService', () => {
  const smsCodeFindFirst = jest.fn();
  const smsCodeCreate = jest.fn();
  const smsCodeUpdateMany = jest.fn();

  const mockCtx = {
    oauthAccount: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
    },
    smsVerificationCode: {
      updateMany: jest.fn(),
    },
    userLoginLog: {
      create: jest.fn(),
    },
  };

  const mockPrisma = {
    $transaction: jest.fn((cb: (tx: typeof mockCtx) => Promise<unknown>) =>
      cb(mockCtx),
    ),
    user: {
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    smsVerificationCode: {
      findFirst: smsCodeFindFirst,
      create: smsCodeCreate,
      updateMany: smsCodeUpdateMany,
    },
  } as unknown as PrismaService;

  const mockJwt = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
  } as unknown as JwtService;

  const mockConfig = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_ACCESS_EXPIRATION') return '15m';
      if (key === 'JWT_REFRESH_EXPIRATION') return '7d';
      return undefined;
    }),
  } as unknown as ConfigService;

  const mockEmailService: Pick<EmailService, 'sendClientLoginCode'> = {
    sendClientLoginCode: jest.fn(),
  };

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(
      mockPrisma,
      mockJwt,
      mockConfig,
      mockEmailService as EmailService,
    );
    (mockJwt.signAsync as jest.Mock)
      .mockResolvedValueOnce('access-token')
      .mockResolvedValueOnce('refresh-token');
  });

  it('creates user/oauth account for first oauth login', async () => {
    mockCtx.oauthAccount.findUnique.mockResolvedValue(null);
    mockCtx.user.findUnique.mockResolvedValue(null);
    mockCtx.user.create.mockResolvedValue({
      id: 'user_1',
      phone: 'google_1234567890',
      nickname: 'ms_test',
      avatar: null,
      phoneMd5: 'md5_phone',
      inviteCode: null,
      vipLevel: 0,
      lastLoginAt: new Date('2026-03-19T00:00:00.000Z'),
      kycStatus: 0,
      selfExclusionExpireAt: null,
    });

    const result = await service.loginWithOauth('google', {
      providerUserId: 'google_sub_1',
      email: 'demo@example.com',
      nickname: 'Demo User',
      avatar: 'https://img.example.com/avatar.png',
    });

    expect(mockCtx.user.create).toHaveBeenCalledTimes(1);
    expect(mockCtx.oauthAccount.upsert).toHaveBeenCalledTimes(1);
    expect(mockCtx.userLoginLog.create).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        id: 'user_1',
        provider: 'google',
        tokens: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
        },
      }),
    );
  });

  it('reuses bound oauth account user on login', async () => {
    mockCtx.oauthAccount.findUnique.mockResolvedValue({
      id: 'oauth_1',
      userId: 'user_existing',
      bindStatus: BIND_STATUS.BOUND,
    });
    mockCtx.user.findUnique.mockResolvedValue({
      id: 'user_existing',
      phone: 'facebook_1234567890',
      nickname: 'Existing User',
      avatar: null,
      phoneMd5: 'md5_phone',
      inviteCode: null,
      vipLevel: 1,
      lastLoginAt: new Date('2026-03-19T00:00:00.000Z'),
      kycStatus: 0,
      selfExclusionExpireAt: null,
    });
    mockCtx.user.update.mockResolvedValue({
      id: 'user_existing',
      phone: 'facebook_1234567890',
      nickname: 'Existing User',
      avatar: null,
      phoneMd5: 'md5_phone',
      inviteCode: null,
      vipLevel: 1,
      lastLoginAt: new Date('2026-03-19T01:00:00.000Z'),
      kycStatus: 0,
      selfExclusionExpireAt: null,
    });

    const result = await service.loginWithOauth('facebook', {
      providerUserId: 'fb_sub_1',
      nickname: 'Existing User',
    });

    expect(mockCtx.user.findUnique).toHaveBeenCalledTimes(1);
    expect(mockCtx.user.create).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        id: 'user_existing',
        provider: 'facebook',
      }),
    );
  });

  it('does not overwrite existing local nickname/avatar for pseudo user', async () => {
    mockCtx.oauthAccount.findUnique.mockResolvedValue(null);
    mockCtx.user.findUnique.mockResolvedValue({
      id: 'user_existing_pseudo',
      phone: 'google_1234567890',
      nickname: 'Local Name',
      avatar: 'https://local/avatar.png',
      phoneMd5: 'md5_phone',
      inviteCode: null,
      vipLevel: 0,
      lastLoginAt: new Date('2026-03-19T00:00:00.000Z'),
      kycStatus: 0,
      selfExclusionExpireAt: null,
    });
    mockCtx.user.update.mockImplementationOnce(
      (input: {
        data: {
          nickname?: string | null;
          avatar?: string | null;
          lastLoginAt: Date;
        };
      }) => {
        expect(input.data.nickname).toBe('Local Name');
        expect(input.data.avatar).toBe('https://local/avatar.png');
        return Promise.resolve({
          id: 'user_existing_pseudo',
          phone: 'google_1234567890',
          nickname: 'Local Name',
          avatar: 'https://local/avatar.png',
          phoneMd5: 'md5_phone',
          inviteCode: null,
          vipLevel: 0,
          lastLoginAt: new Date('2026-03-19T01:00:00.000Z'),
          kycStatus: 0,
          selfExclusionExpireAt: null,
        });
      },
    );

    await service.loginWithOauth('google', {
      providerUserId: 'google_sub_2',
      nickname: 'Provider Name',
      avatar: 'https://provider/avatar.png',
    });

    expect(mockCtx.user.update).toHaveBeenCalledTimes(1);
  });

  it('throws on unsupported provider', async () => {
    const invalidProvider = 'twitter' as never;

    await expect(
      service.loginWithOauth(invalidProvider, {
        providerUserId: 'gh_sub_1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('sends email login code and stores verification record', async () => {
    smsCodeFindFirst.mockResolvedValue(null);

    const result = await service.sendEmailLoginCode('Demo@Example.com ', {
      ip: '127.0.0.1',
    });

    expect(smsCodeCreate).toHaveBeenCalledTimes(1);
    expect(mockEmailService.sendClientLoginCode).toHaveBeenCalledWith(
      'demo@example.com',
      expect.any(String),
      300,
    );
    expect(result.sent).toBe(true);
    expect(typeof result.devCode).toBe('string');
  });

  it('logs in with valid email code and returns tokens', async () => {
    const now = Date.now();
    smsCodeFindFirst.mockResolvedValue({
      id: 'email_req_1',
      codeHash: otpHash('demo@example.com', '123456', ''),
      verifyTimes: 0,
      maxVerifyTimes: 5,
      expiresAt: new Date(now + 60_000),
    });
    mockCtx.smsVerificationCode.updateMany.mockResolvedValue({ count: 1 });
    mockCtx.user.upsert.mockResolvedValue({
      id: 'user_email_1',
      phone: 'mail_abcdef123456789',
      nickname: 'ms_user',
      avatar: null,
      phoneMd5: 'md5_phone',
      inviteCode: null,
      vipLevel: 0,
      lastLoginAt: new Date(now),
      kycStatus: 0,
      selfExclusionExpireAt: null,
    });
    mockCtx.userLoginLog.create.mockImplementationOnce(
      (input: {
        data: {
          loginMethod?: string;
          countryCode?: string;
        };
      }) => {
        expect(input.data.loginMethod).toBe('email');
        expect(input.data.countryCode).toBe('EMAIL');
        return Promise.resolve({});
      },
    );

    const result = await service.loginWithEmailCode(
      'demo@example.com',
      '123456',
      {
        ip: '127.0.0.1',
        ua: 'jest',
      },
    );

    expect(mockCtx.user.upsert).toHaveBeenCalledTimes(1);
    expect(mockCtx.userLoginLog.create).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        id: 'user_email_1',
        email: 'demo@example.com',
        tokens: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
        },
      }),
    );
  });

  it('rejects invalid email code', async () => {
    const now = Date.now();
    smsCodeFindFirst.mockResolvedValue({
      id: 'email_req_2',
      codeHash: otpHash('demo@example.com', '999999', ''),
      verifyTimes: 0,
      maxVerifyTimes: 5,
      expiresAt: new Date(now + 60_000),
    });
    smsCodeUpdateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.loginWithEmailCode('demo@example.com', '123456'),
    ).rejects.toThrow(UnauthorizedException);

    expect(smsCodeUpdateMany).toHaveBeenCalledTimes(1);
  });
});
