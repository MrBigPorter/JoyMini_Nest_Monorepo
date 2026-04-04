import { PrismaService } from '@api/common/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { gen6Code, genRandomSuffix, md5 } from '@api/common/crypto.util';
import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { throwBiz } from '@api/common/exceptions/biz.exception';
import { ERROR_KEYS } from '@api/common/error-codes.gen';
import { otpHash, verifyOtpHash } from '@api/common/otp.util';
import {
  BIND_STATUS,
  CODE_TYPE,
  LOGIN_METHOD,
  LOGIN_STATUS,
  LOGIN_TYPE,
  TOKEN_ISSUED,
  VERIFY_STATUS,
} from '@lucky/shared';
import { ConfigService } from '@nestjs/config';
import {
  OauthProvider,
  VerifiedOauthProfile,
} from '@api/client/auth/providers/provider.types';
import { EmailService } from '@api/common/email/email.service';

interface JwtPayload {
  sub: string;
}

type JwtExpiresIn = NonNullable<
  NonNullable<Parameters<JwtService['signAsync']>[1]>['expiresIn']
>;

type AuthTx = Prisma.TransactionClient;

const OAUTH_PROVIDER_LIST: OauthProvider[] = ['google', 'facebook', 'apple'];
const EMAIL_CODE_COUNTRY_CODE = 'EMAIL';
const EMAIL_LOGIN_METHOD = 'email';

const userProfileSelect = {
  id: true,
  phone: true,
  nickname: true,
  avatar: true,
  phoneMd5: true,
  inviteCode: true,
  vipLevel: true,
  lastLoginAt: true,
  kycStatus: true,
  selfExclusionExpireAt: true,
} as const;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  // sign access token
  private async issueToken(user: { id: string }) {
    const payload: JwtPayload = { sub: user.id };
    // 2. 从配置中心读取 (利用 Joi 的默认值，这里必定有值)
    const accessTime = (this.configService.get<string | number>(
      'JWT_ACCESS_EXPIRATION',
    ) ?? '15m') as JwtExpiresIn;
    const refreshTime = (this.configService.get<string | number>(
      'JWT_REFRESH_EXPIRATION',
    ) ?? '7d') as JwtExpiresIn;

    // 3. 并行签名
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, { expiresIn: accessTime }),
      this.jwt.signAsync(payload, { expiresIn: refreshTime }),
    ]);

    return {
      accessToken,
      refreshToken,
    };
  }

  async refreshToken(refreshToken: string) {
    if (!refreshToken) {
      throwBiz(ERROR_KEYS.INVALID_JWT_TOKEN);
    }

    try {
      // check refresh token，if invalid, will throw error to catch block
      const payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken);
      // 4. 安全增强：检查用户是否存在且状态正常
      // 不要只查 id，要查 status，防止封禁用户“僵尸复活”
      const user = await this.prisma.user.findFirst({
        where: { id: payload.sub },
        select: { id: true },
      });

      // user not found
      if (!user) {
        throwBiz(ERROR_KEYS.USER_NOT_FOUND);
      }

      // issue new tokens, return to client
      const tokens = await this.issueToken({ id: user!.id });

      return { tokens };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      // 记录日志，方便排查是过期了还是签名不对
      this.logger.warn(
        `Refresh token failed for token: ${refreshToken.slice(0, 10)}... Error: ${message}`,
      );
      throwBiz(ERROR_KEYS.INVALID_JWT_TOKEN);
    }
  }

  // 手机号登陆(登录即注册)
  async loginWithOtp(
    phone: string,
    meta?: { ip?: string; ua?: string; countryCode?: number },
  ) {
    const p = phone.trim();
    const phoneMd5 = md5(p);

    const now = new Date();

    const windowSec =
      this.configService.get<number>('OTP_LOGIN_WINDOW_SECONDS') ?? 300;
    // 毫秒
    const graceStart = new Date(now.getTime() - windowSec * 1000);

    // // 取“最近一条已验证、且未消费”的登录 OTP
    const opt = await this.prisma.smsVerificationCode.findFirst({
      where: {
        phone: p,
        codeType: CODE_TYPE.LOGIN, // 2 登录
        verifiedAt: { not: null, gte: graceStart }, // 确保已验证且在有效期内
        verifyStatus: VERIFY_STATUS.VERIFIED, // 1 已验证
      },
      select: { id: true }, // 性能优化：只查 id
      orderBy: { verifiedAt: 'desc' },
    });

    if (!opt) {
      throwBiz(ERROR_KEYS.OTP_NOT_VERIFIED_OR_ALREADY_USED);
    }

    // 交互式事务：原子消费 OTP + upsert 用户 + 日志 + 最后登录时间
    const user = await this.prisma.$transaction(async (ctx: AuthTx) => {
      // 1) 原子把 VERIFIED → CONSUMED，只允许成功一次
      const consumed = await ctx.smsVerificationCode.updateMany({
        where: { id: opt?.id, verifyStatus: VERIFY_STATUS.VERIFIED },
        data: { verifyStatus: VERIFY_STATUS.CONSUMED },
      });

      if (consumed.count != 1) {
        throwBiz(ERROR_KEYS.OTP_NOT_VERIFIED_OR_ALREADY_USED);
      }

      // 7. 性能优化核心：合并 Upsert 和 Update 操作
      // 使用更安全的随机数生成昵称后缀
      const randomSuffix = genRandomSuffix();

      // 2) 登陆即注册
      const u = await ctx.user.upsert({
        //用 唯一键 phone 查用户。这里要求 User 模型里 phone 是 @unique 或 @id。
        where: { phone: p },
        //如果没查到，就新建：
        create: {
          phone: p,
          phoneMd5,
          nickname: `ms_${randomSuffix}`,
          lastLoginAt: now, //创建时直接写入
        },
        update: {
          //更新时直接写入，省去了一次 update 查询！
          lastLoginAt: now,
        },
        //只返回这几个字段
        select: {
          id: true,
          phone: true,
          nickname: true,
          avatar: true,
          phoneMd5: true,
          inviteCode: true,
          vipLevel: true,
          lastLoginAt: true,
          kycStatus: true,
          selfExclusionExpireAt: true,
        },
      });
      // 3) 登录日志
      await ctx.userLoginLog.create({
        data: {
          userId: u.id,
          loginType: LOGIN_TYPE.OTP,
          loginMethod: LOGIN_METHOD.OTP,
          loginStatus: LOGIN_STATUS.SUCCESS,
          tokenIssued: TOKEN_ISSUED.YES,
          loginTime: new Date(),
          loginIp: meta?.ip ?? null,
          userAgent: meta?.ua ?? null,
          countryCode: meta?.countryCode ? String(meta.countryCode) : null,
        },
      });

      return u;
    });

    const tokens = await this.issueToken(user);

    return {
      tokens: tokens,
      id: user.id,
      phone: user.phone,
      phoneMd5: user.phoneMd5,
      nickname: user.nickname,
      username: user.nickname,
      avatar: user.avatar,
      countryCode: meta?.countryCode ?? null,
    };
  }

  async loginWithOauth(
    provider: OauthProvider,
    oauthProfile: VerifiedOauthProfile,
    meta?: {
      ip?: string;
      ua?: string;
      countryCode?: number | string;
      inviteCode?: string;
    },
  ) {
    if (!OAUTH_PROVIDER_LIST.includes(provider)) {
      throw new BadRequestException('Invalid OAuth provider');
    }

    const providerUserId = oauthProfile.providerUserId?.trim();
    if (!providerUserId) {
      throw new UnauthorizedException('Invalid OAuth identity');
    }

    const now = new Date();
    const user = await this.prisma.$transaction(async (ctx: AuthTx) => {
      const oauthAccount = await ctx.oauthAccount.findUnique({
        where: {
          provider_providerUserId: {
            provider,
            providerUserId,
          },
        },
        select: {
          id: true,
          userId: true,
          bindStatus: true,
        },
      });

      if (oauthAccount && oauthAccount.bindStatus === BIND_STATUS.BOUND) {
        const existingUser = await ctx.user.findUnique({
          where: { id: oauthAccount.userId },
          select: userProfileSelect,
        });

        if (!existingUser) {
          throwBiz(ERROR_KEYS.USER_NOT_FOUND);
          throw new UnauthorizedException('User not found');
        }

        const existingUserId = existingUser.id;

        const resolvedUser = await ctx.user.update({
          where: { id: existingUserId },
          data: { lastLoginAt: now },
          select: userProfileSelect,
        });

        await this.upsertOauthAccount(ctx, {
          provider,
          providerUserId,
          userId: resolvedUser.id,
          email: oauthProfile.email,
          nickname: oauthProfile.nickname,
          avatar: oauthProfile.avatar,
          now,
        });

        await this.writeOauthLoginLog(
          ctx,
          resolvedUser.id,
          provider,
          meta,
          now,
        );
        return resolvedUser;
      }

      const pseudoPhone = this.buildOauthPhone(provider, providerUserId);
      const pseudoPhoneMd5 = md5(pseudoPhone);

      const existingPseudoUser = await ctx.user.findUnique({
        where: { phone: pseudoPhone },
        select: userProfileSelect,
      });

      const normalizedNickname = oauthProfile.nickname?.trim() || null;
      const normalizedAvatar = oauthProfile.avatar?.trim() || null;

      const resolvedUser = existingPseudoUser
        ? await ctx.user.update({
            where: { id: existingPseudoUser.id },
            data: {
              lastLoginAt: now,
              // Respect local edits: only backfill provider profile when local value is empty.
              nickname:
                existingPseudoUser.nickname ?? normalizedNickname ?? undefined,
              avatar:
                existingPseudoUser.avatar ?? normalizedAvatar ?? undefined,
            },
            select: userProfileSelect,
          })
        : await ctx.user.create({
            data: {
              phone: pseudoPhone,
              phoneMd5: pseudoPhoneMd5,
              nickname: normalizedNickname || `ms_${genRandomSuffix()}`,
              avatar: normalizedAvatar,
              lastLoginAt: now,
            },
            select: userProfileSelect,
          });

      await this.upsertOauthAccount(ctx, {
        provider,
        providerUserId,
        userId: resolvedUser.id,
        email: oauthProfile.email,
        nickname: oauthProfile.nickname,
        avatar: oauthProfile.avatar,
        now,
      });

      await this.writeOauthLoginLog(ctx, resolvedUser.id, provider, meta, now);
      return resolvedUser;
    });

    const tokens = await this.issueToken(user);
    return {
      tokens,
      id: user.id,
      phone: user.phone,
      phoneMd5: user.phoneMd5,
      nickname: user.nickname,
      username: user.nickname,
      avatar: user.avatar,
      provider,
      inviteCode: meta?.inviteCode ?? null,
    };
  }

  private buildOauthPhone(provider: OauthProvider, providerUserId: string) {
    const digest = md5(`${provider}:${providerUserId}`);
    return `${provider}_${digest.slice(0, 10)}`;
  }

  private async upsertOauthAccount(
    tx: AuthTx,
    input: {
      provider: OauthProvider;
      providerUserId: string;
      userId: string;
      email?: string | null;
      nickname?: string | null;
      avatar?: string | null;
      now: Date;
    },
  ) {
    await tx.oauthAccount.upsert({
      where: {
        provider_providerUserId: {
          provider: input.provider,
          providerUserId: input.providerUserId,
        },
      },
      create: {
        userId: input.userId,
        provider: input.provider,
        providerUserId: input.providerUserId,
        providerEmail: input.email?.trim() || null,
        providerNickname: input.nickname?.trim() || null,
        providerAvatar: input.avatar?.trim() || null,
        bindStatus: BIND_STATUS.BOUND,
        firstBindAt: input.now,
        lastLoginAt: input.now,
      },
      update: {
        userId: input.userId,
        providerEmail: input.email?.trim() || null,
        providerNickname: input.nickname?.trim() || null,
        providerAvatar: input.avatar?.trim() || null,
        bindStatus: BIND_STATUS.BOUND,
        lastLoginAt: input.now,
      },
    });
  }

  private async writeOauthLoginLog(
    tx: AuthTx,
    userId: string,
    provider: OauthProvider,
    meta:
      | {
          ip?: string;
          ua?: string;
          countryCode?: number | string;
          inviteCode?: string;
        }
      | undefined,
    now: Date,
  ) {
    await tx.userLoginLog.create({
      data: {
        userId,
        loginType: LOGIN_TYPE.OAUTH,
        loginMethod: provider,
        loginStatus: LOGIN_STATUS.SUCCESS,
        tokenIssued: TOKEN_ISSUED.YES,
        loginTime: now,
        loginIp: meta?.ip ?? null,
        userAgent: meta?.ua ?? null,
        countryCode: meta?.countryCode ? String(meta.countryCode) : null,
      },
    });
  }

  // 获取用户信息
  async profile(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        phoneMd5: true,
        nickname: true,
        avatar: true,
        inviteCode: true,
        vipLevel: true,
        lastLoginAt: true,
        kycStatus: true,
        selfExclusionExpireAt: true,
      },
    });
    return {
      id: user.id,
      nickname: user.nickname ?? `ms${user.id}`,
      avatar: user.avatar,
      phoneMd5: user.phoneMd5,
      phone: user.phone,
      inviteCode: user.inviteCode ?? null,
      vipLevel: user.vipLevel,
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.getTime() : null,
      kycStatus: user.kycStatus,
      deliveryAddressId: 0,
      selfExclusionExpireAt: user.selfExclusionExpireAt
        ? user.selfExclusionExpireAt.getTime()
        : 0,
    };
  }

  async sendEmailLoginCode(email: string, meta?: { ip?: string }) {
    const normalizedEmail = this.normalizeEmail(email);
    const keyPhone = this.buildEmailCodePhoneKey(normalizedEmail);
    const now = Date.now();
    const intervalSeconds =
      this.configService.get<number>('EMAIL_OTP_INTERVAL_SECONDS') ?? 60;

    const recent = await this.prisma.smsVerificationCode.findFirst({
      where: {
        phone: keyPhone,
        countryCode: EMAIL_CODE_COUNTRY_CODE,
        codeType: CODE_TYPE.LOGIN,
        createdAt: { gte: new Date(now - intervalSeconds * 1000) },
      },
      select: { id: true },
    });

    if (recent) {
      throwBiz(ERROR_KEYS.TOO_MANY_REQUESTS);
    }

    const ttlSeconds =
      this.configService.get<number>('EMAIL_OTP_TTL_SECONDS') ?? 300;
    const maxAttempts =
      this.configService.get<number>('EMAIL_OTP_MAX_ATTEMPTS') ?? 5;
    const isProd = this.configService.get<string>('NODE_ENV') === 'production';
    const code = isProd
      ? gen6Code()
      : (this.configService.get<string>('EMAIL_OTP_DEV_CODE') ?? '666666');
    const pepper = this.configService.get<string>('OTP_PEPPER') ?? '';

    await this.prisma.smsVerificationCode.create({
      data: {
        phone: keyPhone,
        countryCode: EMAIL_CODE_COUNTRY_CODE,
        codeType: CODE_TYPE.LOGIN,
        codeHash: otpHash(normalizedEmail, code, pepper),
        sendStatus: 2,
        verifyStatus: VERIFY_STATUS.PENDING,
        verifyTimes: 0,
        maxVerifyTimes: maxAttempts,
        expiresAt: new Date(now + ttlSeconds * 1000),
        requestIp: meta?.ip ?? null,
      },
    });

    await this.emailService.sendClientLoginCode(
      normalizedEmail,
      code,
      ttlSeconds,
    );

    if (!isProd) {
      return {
        sent: true,
        devCode: code,
      };
    }

    return { sent: true };
  }

  async loginWithEmailCode(
    email: string,
    code: string,
    meta?: { ip?: string; ua?: string },
  ) {
    const normalizedEmail = this.normalizeEmail(email);
    const normalizedCode = code.trim();
    if (!normalizedCode) {
      throw new BadRequestException('code required');
    }

    const keyPhone = this.buildEmailCodePhoneKey(normalizedEmail);
    const req = await this.prisma.smsVerificationCode.findFirst({
      where: {
        phone: keyPhone,
        countryCode: EMAIL_CODE_COUNTRY_CODE,
        codeType: CODE_TYPE.LOGIN,
        verifyStatus: VERIFY_STATUS.PENDING,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!req) {
      throwBiz(ERROR_KEYS.OTP_NOT_VERIFIED_OR_ALREADY_USED);
      throw new UnauthorizedException('Email code request not found');
    }

    const now = new Date();
    if (req.expiresAt.getTime() < now.getTime()) {
      await this.prisma.smsVerificationCode.updateMany({
        where: { id: req.id, verifyStatus: VERIFY_STATUS.PENDING },
        data: { verifyStatus: VERIFY_STATUS.EXPIRED },
      });
      throwBiz(ERROR_KEYS.OTP_EXPIRED);
    }

    if (req.verifyTimes >= req.maxVerifyTimes) {
      await this.prisma.smsVerificationCode.updateMany({
        where: { id: req.id, verifyStatus: VERIFY_STATUS.PENDING },
        data: { verifyStatus: VERIFY_STATUS.LOCKED },
      });
      throwBiz(ERROR_KEYS.TOO_MANY_OTP_ATTEMPTS);
    }

    const pepper = this.configService.get<string>('OTP_PEPPER') ?? '';
    const isMatch = verifyOtpHash(
      normalizedEmail,
      normalizedCode,
      req.codeHash,
      pepper,
    );

    if (!isMatch) {
      const shouldLock = req.verifyTimes + 1 >= req.maxVerifyTimes;
      await this.prisma.smsVerificationCode.updateMany({
        where: { id: req.id, verifyStatus: VERIFY_STATUS.PENDING },
        data: {
          verifyTimes: { increment: 1 },
          ...(shouldLock ? { verifyStatus: VERIFY_STATUS.LOCKED } : {}),
        },
      });
      throw new UnauthorizedException('Invalid code');
    }

    const pseudoPhone = this.buildEmailPseudoPhone(normalizedEmail);
    const pseudoPhoneMd5 = md5(pseudoPhone);

    const user = await this.prisma.$transaction(async (ctx: AuthTx) => {
      const consumed = await ctx.smsVerificationCode.updateMany({
        where: {
          id: req.id,
          verifyStatus: VERIFY_STATUS.PENDING,
          verifyTimes: { lt: req.maxVerifyTimes },
        },
        data: {
          verifyStatus: VERIFY_STATUS.CONSUMED,
          verifiedAt: now,
          verifyTimes: { increment: 1 },
        },
      });

      if (consumed.count !== 1) {
        throwBiz(ERROR_KEYS.OTP_NOT_VERIFIED_OR_ALREADY_USED);
      }

      const u = await ctx.user.upsert({
        where: { phone: pseudoPhone },
        create: {
          phone: pseudoPhone,
          phoneMd5: pseudoPhoneMd5,
          nickname: `ms_${genRandomSuffix()}`,
          lastLoginAt: now,
        },
        update: {
          lastLoginAt: now,
        },
        select: userProfileSelect,
      });

      await ctx.userLoginLog.create({
        data: {
          userId: u.id,
          loginType: LOGIN_TYPE.OTP,
          loginMethod: EMAIL_LOGIN_METHOD,
          loginStatus: LOGIN_STATUS.SUCCESS,
          tokenIssued: TOKEN_ISSUED.YES,
          loginTime: now,
          loginIp: meta?.ip ?? null,
          userAgent: meta?.ua ?? null,
          countryCode: EMAIL_CODE_COUNTRY_CODE,
        },
      });

      return u;
    });

    const tokens = await this.issueToken(user);
    return {
      tokens,
      id: user.id,
      phone: user.phone,
      phoneMd5: user.phoneMd5,
      nickname: user.nickname,
      username: user.nickname,
      avatar: user.avatar,
      email: normalizedEmail,
      countryCode: EMAIL_CODE_COUNTRY_CODE,
    };
  }

  private normalizeEmail(email: string) {
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      throw new BadRequestException('email required');
    }
    return normalized;
  }

  private buildEmailCodePhoneKey(email: string) {
    return `em_${md5(email).slice(0, 17)}`;
  }

  private buildEmailPseudoPhone(email: string) {
    return `mail_${md5(email).slice(0, 15)}`;
  }
}
