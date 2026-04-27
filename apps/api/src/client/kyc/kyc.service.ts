import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { SubmitKycDto } from '@api/client/kyc/dto/submit-kyc.dto';
import { KYC_STATUS, KycStatus, TimeHelper } from '@lucky/shared';
import { UploadService } from '@api/common/upload/upload.service';
import { KycProviderService } from '@api/common/kyc-provider/kyc-provider.service';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/edge';
import { DeviceInfo } from '@api/common/decorators/http.decorators';
import dayjs from 'dayjs';

// 限制图片大小策略 (Fail Fast)
const MIN_IMAGE_SIZE = 5 * 1024; // 5KB (小于这个通常是损坏文件或纯色块)
const MAX_IMAGE_SIZE = 15 * 1024 * 1024; // 15MB (太大浪费带宽和内存)

@Injectable()
export class KycService {
  constructor(
    private prismaService: PrismaService,
    private uploadService: UploadService,
    private kycProvider: KycProviderService,
  ) {}

  /**
   * Validate image size
   * @param buffer
   * @param fieldName
   */
  validateImageSize(buffer: Buffer, fieldName: string) {
    const size = buffer.length;
    if (size < MIN_IMAGE_SIZE) {
      throw new BadRequestException(
        `Uploaded file for ${fieldName} is too small to be a valid image.`,
      );
    }
    if (size > MAX_IMAGE_SIZE) {
      throw new BadRequestException(
        `Uploaded file for ${fieldName} exceeds the maximum allowed size of ${MAX_IMAGE_SIZE / (1024 * 1024)} MB.`,
      );
    }
  }

  /**
   * Create a liveness detection session for the user
   * @param userId
   */
  async createSession(userId: string) {
    const DAILY_LIMIT = 2; // 每用户每天最多创建 2 次
    const REUSE_WINDOW_MINUTES = 10; // 10 分钟内复用已有 session
    const startOfDay = TimeHelper.getStartOfDay();

    // 多天冷却策略
    const REJECT_COOLDOWN_HOURS = 72; // 3天
    const PENALTY_WINDOW_DAYS = 30;
    const PENALTY_REJECT_COUNT = 2;
    const PENALTY_COOLDOWN_DAYS = 7;

    // 0) 如果正在审核，直接禁止
    const latestKyc = await this.prismaService.kycRecord.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { kycStatus: true, createdAt: true, auditedAt: true },
    });

    if (latestKyc?.kycStatus === KYC_STATUS.REVIEWING) {
      throw new BadRequestException(
        'KYC is under review, cannot create session',
      );
    }

    if (latestKyc?.kycStatus === KYC_STATUS.APPROVED) {
      throw new BadRequestException(
        'KYC already approved, cannot create session',
      );
    }

    // 1) 30天内被拒次数 -> 惩罚冷却
    const rejectCount = await this.prismaService.kycRecord.count({
      where: {
        userId,
        kycStatus: KYC_STATUS.REJECTED,
        createdAt: {
          gte: TimeHelper.getTimeAgo(PENALTY_WINDOW_DAYS, 'day'),
        },
      },
    });

    // 2) 如果最新一次是 REJECTED，检查冷却（优先用 auditedAt，没有就用 createdAt）
    if (latestKyc?.kycStatus === KYC_STATUS.REJECTED) {
      const base = latestKyc.auditedAt ?? latestKyc.createdAt;

      // 惩罚冷却（更长）
      if (rejectCount >= PENALTY_REJECT_COUNT) {
        const until = dayjs(base).add(PENALTY_COOLDOWN_DAYS, 'day').toDate();
        if (until > new Date()) {
          throw new BadRequestException(
            `Due to multiple recent KYC rejections, you can create a new session after ${dayjs(
              until,
            ).format('YYYY-MM-DD HH:mm:ss')}`,
          );
        }
      } else {
        // 普通冷却
        const until = dayjs(base).add(REJECT_COOLDOWN_HOURS, 'hour').toDate();
        if (until > new Date()) {
          throw new BadRequestException(
            `You can create a new KYC session after ${dayjs(until).format(
              'YYYY-MM-DD HH:mm:ss',
            )}`,
          );
        }
      }
    }

    // 1. 检查当天创建次数
    const todayCount = await this.prismaService.kycLivenessSession.count({
      where: {
        userId,
        createdAt: { gte: startOfDay },
      },
    });
    if (todayCount >= DAILY_LIMIT) {
      throw new BadRequestException(
        `Daily KYC session limit reached (${DAILY_LIMIT}/day)`,
      );
    }

    // 2. 检查最近是否有未使用的 session 可复用
    const reusableSession =
      await this.prismaService.kycLivenessSession.findFirst({
        where: {
          userId,
          usedAt: null,
          createdAt: {
            gte: TimeHelper.getTimeAgo(REUSE_WINDOW_MINUTES, 'minute'),
          },
        },
        orderBy: { createdAt: 'desc' },
      });

    if (reusableSession) {
      return {
        sessionId: reusableSession.sessionId,
        reused: true,
        todayUsedCount: todayCount, // 没有新增创建次数
        dailyLimit: DAILY_LIMIT,
        remaining: DAILY_LIMIT - todayCount,
      };
    }

    // 3. 创建新 session
    const session = await this.kycProvider.createLivenessSession(userId);

    if (!session || !session.sessionId) {
      throw new BadRequestException('Could not create KYC liveness session');
    }

    // 4. 记录到数据库
    await this.prismaService.kycLivenessSession.upsert({
      where: { sessionId: session.sessionId },
      create: {
        userId,
        sessionId: session.sessionId,
      },
      update: {},
    });

    const newCount = todayCount + 1;

    return {
      sessionId: session.sessionId,
      reused: false,
      todayUsedCount: newCount,
      dailyLimit: DAILY_LIMIT,
      remaining: DAILY_LIMIT - newCount,
    };
  }

  /**
   * Get the latest KYC record for the current user
   * @param userId
   */
  async getMyKyc(userId: string) {
    const record = await this.prismaService.kycRecord.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    if (record) {
      return record;
    }

    return {
      kycStatus: 0, // 0: Draft / 未认证状态 (最重要的字段)
      idType: 0, // 默认证件类型为 0 或 未知
      isSameAddress: true, // 布尔值兜底
      riskLevel: 0, // 默认风控等级
      createdAt: new Date(), // 创建时间兜底
    };
  }

  /**
   * Get active ID types
   */
  async getIdTypes() {
    return this.prismaService.kycIdType.findMany({
      where: { status: 1 },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Perform OCR on the provided ID card image
   * @param userId
   * @param idCardKey
   */
  async ocrIdCard(userId: string, idCardKey: string) {
    // 校验文件是否存在且有权限访问
    const imageBuffer = await this.uploadService.getFileBuffer(
      idCardKey,
      'kyc',
      userId,
    );

    // 验证图片大小
    await this.validateImageSize(imageBuffer, 'ID Card');

    // 调用 KYC Provider 进行 OCR
    // 3. 只有检查通过了，才去调用昂贵的 OCR 服务
    // 注意：如果 UploadService 实现了缓存，这里不会重复下载
    // 如果 KycProvider 支持传入 Buffer，建议修改 KycProvider 接口直接传 imageBuffer，避免二次下载
    return await this.kycProvider.ocrIdCardByKey(userId, idCardKey);
  }

  /**
   * Perform OCR on the provided ID card image buffer
   * @param buffer
   */
  async scanIdCard(buffer: Buffer) {
    // 1. 基础校验
    await this.validateImageSize(buffer, 'OCR Scan File');
    // 2. 直接调 Provider (内存处理)
    const result = await this.kycProvider.ocrIdCardByBuffer(buffer);
    // 3. 风控拦截：如果是极为明显的假图，直接报错，不给用户回填机会
    if (result.isSuspicious && result.fraudScore > 90) {
      throw new BadRequestException(
        'The uploaded ID card image appears to be invalid. Please use a different image.',
      );
    }
    return result;
  }

  /**
   * Submit KYC information， including liveness verification and ID card matching
   * 接收前端传来的文件流 -> 校验 -> 上传 S3 -> 入库
   * @param userId
   * @param dto
   * @param frontFile
   * @param backFile
   * @param device
   */
  async submitKyc(
    userId: string,
    dto: SubmitKycDto,
    frontFile: Express.Multer.File,
    backFile: Express.Multer.File | null,
    device: DeviceInfo,
  ) {
    // 1) 文件大小校验（Fail Fast）
    await this.validateImageSize(frontFile.buffer, 'ID Card Front');
    if (backFile) await this.validateImageSize(backFile.buffer, 'ID Card Back');

    // 2) ID Type 校验
    const idType = await this.prismaService.kycIdType.findFirst({
      where: { id: dto.idType, status: 1 },
    });
    if (!idType) throw new BadRequestException('Invalid ID type');

    return this.prismaService.$transaction(
      async (ctx) => {
        // A) 先做“不会消耗 session”的校验（保留你原来的 findUnique 逻辑，错误更清晰）
        const session = await ctx.kycLivenessSession.findUnique({
          where: { sessionId: dto.sessionId },
          select: { sessionId: true, userId: true, usedAt: true },
        });

        if (!session || session.userId !== userId) {
          throw new ConflictException('KYC session not found.');
        }
        if (session.usedAt) {
          throw new ConflictException('KYC session not found or already used.');
        }

        // B) duplicate id（全局）
        const duplicateId = await ctx.kycRecord.findFirst({
          where: {
            idNumber: dto.idNumber,
            userId: { not: userId },
            kycStatus: { in: [KYC_STATUS.REVIEWING, KYC_STATUS.APPROVED] },
          },
          select: { id: true },
        });
        if (duplicateId) {
          throw new ConflictException('Identity document already in use.');
        }

        // C) 本人最新 KYC 状态校验
        const existing = await ctx.kycRecord.findFirst({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          select: { kycStatus: true },
        });

        if (existing?.kycStatus === KYC_STATUS.APPROVED) {
          throw new BadRequestException(
            'KYC already approved, cannot resubmit',
          );
        }
        if (existing?.kycStatus === KYC_STATUS.REVIEWING) {
          throw new BadRequestException('KYC is under review, cannot resubmit');
        }

        // D) 所有校验通过后，再“原子占用” session（防并发复用）
        const claimedAt = new Date();
        const claim = await ctx.kycLivenessSession.updateMany({
          where: {
            sessionId: dto.sessionId,
            userId,
            usedAt: null,
          },
          data: { usedAt: claimedAt },
        });

        if (claim.count !== 1) {
          throw new ConflictException('KYC session not found or already used.');
        }

        try {
          //  优化开始：并行加速 (Promise.all) ---
          // 同时启动：1. 活体比对  2. 上传正面图  3. 上传背面图(如果有)
          const [verificationResult, frontUploadResult, backUploadResult] =
            await Promise.all([
              // 任务 1: 算力任务
              this.kycProvider.verifyLivenessAndMatchIdCard(
                userId,
                dto.sessionId,
                frontFile.buffer,
              ),
              // 任务 2: IO 任务 (上传 Front)
              this.uploadService.uploadBuffer(
                frontFile.buffer,
                'kyc',
                userId,
                frontFile.mimetype,
                'id-card-front',
              ),
              // 任务 3: IO 任务 (上传 Back - 可选)
              backFile
                ? this.uploadService.uploadBuffer(
                    backFile.buffer,
                    'kyc',
                    userId,
                    backFile.mimetype,
                    'id-card-back',
                  )
                : Promise.resolve(null),
            ]);

          // 解构结果
          const { passed, reason, livenessConfidence, referenceImageBytes } =
            verificationResult;
          const { key: frontKey } = frontUploadResult;
          const backKey = backUploadResult?.key ?? null;

          // G) 初始状态判定 + faceImageKey（只信任后端生成的）
          let initialStatus: KycStatus = KYC_STATUS.REVIEWING;
          let autoRejectReason: string | null = null;
          let faceImageKey: string | null = null;

          if (passed) {
            if (!referenceImageBytes) {
              initialStatus = KYC_STATUS.REJECTED;
              autoRejectReason =
                'No reference image returned from KYC provider';
            } else {
              const imageBuffer = Buffer.from(referenceImageBytes);
              const { key } = await this.uploadService.uploadBuffer(
                imageBuffer,
                'kyc',
                userId,
                'image/jpeg',
                'face-image',
              );
              faceImageKey = key;
            }
          } else {
            initialStatus = KYC_STATUS.REJECTED;
            autoRejectReason = reason || 'Machine verification failed';
          }

          // H) 入库
          const record = await ctx.kycRecord.create({
            data: {
              userId,
              sessionId: dto.sessionId,
              kycStatus: initialStatus,
              idType: dto.idType,
              idNumber: dto.idNumber,
              realName: dto.realName,
              firstName: dto.firstName,
              middleName: dto.middleName,
              lastName: dto.lastName,
              idCardFront: frontKey,
              idCardBack: backKey,
              faceImage: faceImageKey,
              province: dto.provinceId.toString(),
              city: dto.cityId.toString(),
              barangay: dto.barangayId.toString(),
              livenessScore: livenessConfidence ?? 0,
              ocrRawData: dto.ocrRawData ?? {},
              submittedAt: new Date(),
              auditResult: autoRejectReason ? 'Auto-rejected by System' : null,
              rejectReason: autoRejectReason,
              auditedAt:
                initialStatus === KYC_STATUS.REJECTED ? new Date() : null,
              ipAddress: device.ip,
              deviceId: device.deviceId,
              deviceModel: device.deviceModel,
            },
          });

          // I) 同步用户 KYC 状态
          await ctx.user.update({
            where: { id: userId },
            data: { kycStatus: initialStatus },
          });

          return record;
        } catch (error: any) {
          // J) 手动回滚 claim（只回滚本次 claimedAt 的占用）
          await ctx.kycLivenessSession.updateMany({
            where: { sessionId: dto.sessionId, userId, usedAt: claimedAt },
            data: { usedAt: null },
          });

          if (
            error instanceof PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            const target = error.meta?.target as string[] | undefined;
            if (target?.includes('sessionId')) {
              throw new ConflictException(
                'Liveness session already used (DB Constraint).',
              );
            }
            if (target?.includes('idNumber')) {
              throw new ConflictException('Identity document already in use.');
            }
          }

          throw error;
        }
      },
      {
        maxWait: 5000, // 默认 2000
        timeout: 20000, // 默认 5000 -> 改为 20000 (20秒)
      },
    );
  }
}
