import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { PasswordService } from '@api/common/service/password.service';
import { EmailService } from '@api/common/email/email.service';
import { RecaptchaService } from '@api/common/recaptcha/recaptcha.service';
import { RedisService } from '@api/common/redis/redis.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { ListApplicationDto } from './dto/list-application.dto';
import { ReviewApplicationDto } from './dto/review-application.dto';
import { Role } from '@lucky/shared';

// ─── Disposable email domain blocklist ──────────────────────────────────────
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'temp-mail.org',
  'throwam.com',
  'yopmail.com',
  'sharklasers.com',
  'guerrillamailblock.com',
  'grr.la',
  'guerrillamail.info',
  'guerrillamail.biz',
  'guerrillamail.de',
  'guerrillamail.net',
  'guerrillamail.org',
  'spam4.me',
  'trashmail.com',
  'trashmail.me',
  'trashmail.net',
  'dispostable.com',
  'fakeinbox.com',
  'mailnull.com',
  'spamgourmet.com',
  'spamgourmet.net',
  'spamgourmet.org',
  'maildrop.cc',
  'spamspot.com',
  'spamthis.co.uk',
  'tempmail.com',
  'tempmail.net',
  'tempr.email',
  'throwam.com',
  '10minutemail.com',
  'minutemail.com',
  'discard.email',
  'mailexpire.com',
  'mytrashmail.com',
  'throwaway.email',
  'spamevader.com',
  'discardmail.com',
]);

/** Redis key: IP application rate limit */
const ipKey = (ip: string) => `apply:ip:${ip}`;
/** Max applications per IP per 24 hours */
const IP_LIMIT = 3;
const IP_WINDOW_SECONDS = 86_400;

@Injectable()
export class RegisterApplicationService {
  private readonly logger = new Logger(RegisterApplicationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly emailService: EmailService,
    private readonly recaptchaService: RecaptchaService,
    private readonly redisService: RedisService,
  ) {}

  // ─── LAYER 1: Public — submit application ─────────────────────────────────

  async create(dto: CreateApplicationDto, ip: string) {
    // L1: reCAPTCHA v3 verification
    await this.recaptchaService.verify(dto.recaptchaToken, 'admin_apply');

    // L2: IP-based rate limiting (3 per IP per 24h)
    await this.checkIpRateLimit(ip);

    // L3: Disposable email domain check
    this.validateEmailDomain(dto.email);

    // L4: Username conflict — check AdminUser table
    const existingAdmin = await this.prisma.adminUser.findUnique({
      where: { username: dto.username },
      select: { id: true },
    });
    if (existingAdmin) {
      throw new ConflictException('Username is already taken');
    }

    // L5: Duplicate pending application — same username or same email
    const duplicatePending =
      await this.prisma.adminRegisterApplication.findFirst({
        where: {
          status: 'pending',
          OR: [{ username: dto.username }, { email: dto.email }],
        },
        select: { id: true, username: true, email: true },
      });
    if (duplicatePending) {
      if (duplicatePending.username === dto.username) {
        throw new ConflictException(
          'An application with this username is already pending review',
        );
      }
      throw new ConflictException(
        'An application with this email is already pending review',
      );
    }

    // Hash password before storage
    const hashedPassword = await this.passwordService.hash(dto.password);

    const application = await this.prisma.adminRegisterApplication.create({
      data: {
        username: dto.username,
        password: hashedPassword,
        realName: dto.realName,
        email: dto.email,
        applyReason: dto.applyReason,
        applyIp: ip,
        status: 'pending',
      },
    });

    // Increment IP counter
    await this.incrementIpCounter(ip);

    // Send acknowledgement email (fire-and-forget)
    this.emailService
      .sendApplicationReceived(dto.email, dto.realName)
      .catch((e) => this.logger.error(`Email failed: ${e}`));

    return {
      message:
        'Application submitted. You will receive an email once reviewed.',
      id: application.id,
    };
  }

  // ─── LAYER 2: Admin — list applications ───────────────────────────────────

  async findAll(query: ListApplicationDto) {
    const { page = 1, pageSize = 20, status = 'pending', username } = query;
    const skip = (page - 1) * pageSize;

    const where: {
      status?: string;
      username?: { contains: string; mode: 'insensitive' };
    } = {};
    if (status && status !== 'all') where.status = status;
    if (username) where.username = { contains: username, mode: 'insensitive' };

    const [total, list] = await this.prisma.$transaction([
      this.prisma.adminRegisterApplication.count({ where }),
      this.prisma.adminRegisterApplication.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          username: true,
          realName: true,
          email: true,
          applyReason: true,
          applyIp: true,
          status: true,
          reviewedBy: true,
          reviewNote: true,
          reviewedAt: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      list: list.map((item: any) => ({
        ...item,
        createdAt: item.createdAt.getTime(),
        reviewedAt: item.reviewedAt?.getTime() ?? null,
      })),
    };
  }

  /** Badge count for sidebar */
  async pendingCount() {
    const count = await this.prisma.adminRegisterApplication.count({
      where: { status: 'pending' },
    });
    return { count };
  }

  // ─── LAYER 3: Admin — approve ─────────────────────────────────────────────

  async approve(id: string, reviewerId: string) {
    const app = await this.findPendingOrThrow(id);

    // Check username is still available (someone may have been created with same username)
    const conflict = await this.prisma.adminUser.findUnique({
      where: { username: app.username },
      select: { id: true },
    });
    if (conflict) {
      throw new ConflictException(
        `Username "${app.username}" was taken after this application was submitted. Reject and ask applicant to re-apply.`,
      );
    }

    await this.prisma.$transaction(async (ctx: any) => {
      // Create AdminUser with VIEWER role (least privilege)
      await ctx.adminUser.create({
        data: {
          username: app.username,
          password: app.password,
          realName: app.realName,
          role: Role.VIEWER,
          status: 1,
        },
      });

      // Mark application as approved
      await ctx.adminRegisterApplication.update({
        where: { id },
        data: {
          status: 'approved',
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
        },
      });
    });

    // Notify applicant (fire-and-forget)
    this.emailService
      .sendApplicationApproved(app.email, app.realName, app.username)
      .catch((e) => this.logger.error(`Email failed: ${e}`));

    this.logger.log(
      `Application ${id} approved by ${reviewerId} → AdminUser(${app.username}, VIEWER)`,
    );

    return {
      message: `Application approved. Account created for "${app.username}"`,
    };
  }

  // ─── LAYER 4: Admin — reject ──────────────────────────────────────────────

  async reject(id: string, dto: ReviewApplicationDto, reviewerId: string) {
    const app = await this.findPendingOrThrow(id);

    await this.prisma.adminRegisterApplication.update({
      where: { id },
      data: {
        status: 'rejected',
        reviewedBy: reviewerId,
        reviewNote: dto.reviewNote,
        reviewedAt: new Date(),
      },
    });

    // Notify applicant (fire-and-forget)
    this.emailService
      .sendApplicationRejected(app.email, app.realName, dto.reviewNote)
      .catch((e) => this.logger.error(`Email failed: ${e}`));

    return { message: 'Application rejected' };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async findPendingOrThrow(id: string) {
    const app = await this.prisma.adminRegisterApplication.findUnique({
      where: { id },
    });
    if (!app) throw new NotFoundException('Application not found');
    if (app.status !== 'pending') {
      throw new BadRequestException(
        `Application is already "${app.status}" and cannot be reviewed again`,
      );
    }
    return app;
  }

  private validateEmailDomain(email: string) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) throw new BadRequestException('Invalid email address');
    if (DISPOSABLE_DOMAINS.has(domain)) {
      throw new BadRequestException(
        'Disposable email addresses are not allowed. Please use your work or personal email.',
      );
    }
  }

  private async checkIpRateLimit(ip: string) {
    const key = ipKey(ip);
    const raw = await this.redisService.get(key);
    const count = raw ? parseInt(raw, 10) : 0;
    if (count >= IP_LIMIT) {
      throw new ForbiddenException(
        `Too many applications from your IP address. Please try again in 24 hours.`,
      );
    }
  }

  private async incrementIpCounter(ip: string) {
    const key = ipKey(ip);
    const raw = await this.redisService.get(key);
    const count = raw ? parseInt(raw, 10) : 0;
    // set with TTL only on first entry to keep natural 24h window
    if (count === 0) {
      await this.redisService.set(key, '1', IP_WINDOW_SECONDS);
    } else {
      await this.redisService.set(key, String(count + 1), IP_WINDOW_SECONDS);
    }
  }
}
