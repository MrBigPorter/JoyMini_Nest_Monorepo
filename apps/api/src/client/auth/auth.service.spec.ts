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
    blogComment: {
      updateMany: jest.fn(),
    },
    userBookmark: {
      deleteMany: jest.fn(),
    },
    chatMessage: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    chatMember: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    conversation: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    conversationFlowBinding: {
      deleteMany: jest.fn(),
    },
    groupJoinRequest: {
      deleteMany: jest.fn(),
    },
    aiTrace: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    aiScore: {
      deleteMany: jest.fn(),
    },
    aiAnswerFeedback: {
      deleteMany: jest.fn(),
    },
    aiUserMemory: {
      deleteMany: jest.fn(),
    },
    aiMemorySummary: {
      deleteMany: jest.fn(),
    },
  };

  const mockPrisma = {
    $transaction: jest.fn((cb: (tx: typeof mockCtx) => Promise<unknown>) =>
      cb(mockCtx),
    ),
    oauthAccount: {
      findMany: jest.fn(),
    },
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

  it('cascades AI data and user messages on account deletion', async () => {
    (mockPrisma.oauthAccount.findMany as jest.Mock).mockResolvedValue([
      { providerEmail: 'demo@example.com' },
    ]);
    mockCtx.blogComment.updateMany.mockResolvedValue({ count: 1 });
    mockCtx.chatMessage.findMany.mockResolvedValue([
      { id: 'msg_1', conversationId: 'conv_user_only' },
      { id: 'msg_2', conversationId: 'conv_shared' },
    ]);
    mockCtx.chatMember.findMany.mockResolvedValue([
      { conversationId: 'conv_user_only' },
      { conversationId: 'conv_shared' },
    ]);
    mockCtx.aiTrace.findMany.mockResolvedValue([
      { id: 'trace_1' },
      { id: 'trace_2' },
    ]);
    mockCtx.aiScore.deleteMany.mockResolvedValue({ count: 4 });
    mockCtx.aiAnswerFeedback.deleteMany.mockResolvedValue({ count: 2 });
    mockCtx.aiTrace.deleteMany.mockResolvedValue({ count: 2 });
    mockCtx.chatMessage.deleteMany.mockResolvedValue({ count: 2 });
    mockCtx.chatMember.deleteMany.mockResolvedValue({ count: 2 });
    mockCtx.conversation.findMany.mockResolvedValue([
      { id: 'conv_user_only' },
    ]);
    mockCtx.conversationFlowBinding.deleteMany.mockResolvedValue({ count: 1 });
    mockCtx.groupJoinRequest.deleteMany.mockResolvedValue({ count: 0 });
    mockCtx.conversation.deleteMany.mockResolvedValue({ count: 1 });
    mockCtx.aiUserMemory.deleteMany.mockResolvedValue({ count: 3 });
    mockCtx.aiMemorySummary.deleteMany.mockResolvedValue({ count: 4 });
    mockCtx.userBookmark.deleteMany.mockResolvedValue({ count: 5 });
    mockCtx.user.update.mockResolvedValue({});

    const result = await service.clearUserData('user_1');

    expect(result).toEqual({
      accountDeleted: true,
      anonymizedComments: 1,
      deletedBookmarks: 5,
    });

    // 只按用户自己的消息/会话收口，不扫描其他成员的数据。
    expect(mockCtx.aiScore.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { traceId: { in: ['trace_1', 'trace_2'] } },
          { conversationId: { in: ['conv_user_only', 'conv_shared'] } },
          { messageId: { in: ['msg_1', 'msg_2'] } },
        ],
      },
    });
    expect(mockCtx.aiAnswerFeedback.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { userId: 'user_1' },
          { conversationId: { in: ['conv_user_only', 'conv_shared'] } },
        ],
      },
    });
    expect(mockCtx.aiTrace.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
    });
    expect(mockCtx.chatMessage.deleteMany).toHaveBeenCalledWith({
      where: { senderId: 'user_1' },
    });
    expect(mockCtx.chatMember.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
    });

    // 只有“无剩余消息 + 无其他成员”的会话才删除。
    expect(mockCtx.conversation.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['conv_user_only', 'conv_shared'] },
        messages: { none: {} },
        members: { none: {} },
      },
      select: { id: true },
    });
    expect(mockCtx.conversationFlowBinding.deleteMany).toHaveBeenCalledWith({
      where: { conversationId: { in: ['conv_user_only'] } },
    });
    expect(mockCtx.groupJoinRequest.deleteMany).toHaveBeenCalledWith({
      where: { groupId: { in: ['conv_user_only'] } },
    });
    expect(mockCtx.conversation.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['conv_user_only'] } },
    });

    // 记忆 + 书签 + 账号软删除。
    expect(mockCtx.aiUserMemory.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
    });
    expect(mockCtx.aiMemorySummary.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
    });
    expect(mockCtx.userBookmark.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
    });
    expect(mockCtx.user.update).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: { status: 0 },
    });
  });
});
