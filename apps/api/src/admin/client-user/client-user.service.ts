import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import {
  BanDeviceDto,
  QueryClientUserDto,
  UpdateUserStatusDto,
} from '@api/admin/client-user/dto/client-user.dto';
import { Prisma } from '@prisma/client';
import { TimeHelper } from '@lucky/shared';
import { RedisService } from '@api/common/redis/redis.service';

@Injectable()
export class ClientUserService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * 查询用户列表
   * @param query
   */
  async findAll(query: QueryClientUserDto) {
    const { page, pageSize, phone, userId, kycStatus, startTime, endTime } =
      query;

    const skip = (page - 1) * pageSize;
    const take = pageSize;

    // 构建查询条件
    const whereConditions: Prisma.UserWhereInput = {};

    if (userId) {
      whereConditions.id = userId;
    }

    // 手机号模糊查询
    if (phone) {
      whereConditions.phone = { contains: phone };
    }

    // kycStatus 精确查询
    if (kycStatus !== undefined) {
      whereConditions.kycStatus = kycStatus;
    }

    // 用户状态精确查询
    if (query.status !== undefined) {
      whereConditions.status = query.status;
    }

    // 注册时间范围查询
    if (startTime || endTime) {
      whereConditions.createdAt = {};
      if (startTime) {
        whereConditions.createdAt.gte = TimeHelper.toDate(startTime);
      }
      if (endTime) {
        whereConditions.createdAt.lte = TimeHelper.toDate(endTime);
      }
    }

    // 查询用户和总数
    const [total, users] = await this.prismaService.$transaction([
      this.prismaService.user.count({ where: whereConditions }),
      this.prismaService.user.findMany({
        where: whereConditions,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
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
          createdAt: true,
          status: true,
          // Add other fields as necessary
          wallet: {
            select: {
              realBalance: true,
              coinBalance: true,
            },
          },
        },
      }),
    ]);
    return {
      total,
      list: users.map((user) => ({
        ...user,
        wallet: user.wallet || { realBalance: 0, coinBalance: 0 },
      })),
      page,
      pageSize,
    };
  }

  /**
   * 查询单个用户详情
   * @param userId
   */
  async findOne(userId: string) {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      include: {
        wallet: true, // 包含钱包信息
        // 最近使用的5个设备
        devices: {
          take: 5,
          orderBy: {
            lastActiveAt: 'desc',
          },
        },
        // 最近的5条登录日志
        loginLogs: {
          take: 5,
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });
    if (!user) throw new NotFoundException(`User with ID ${userId} not found`);
    const enrichedDevices = await this.getUserDevices(userId);
    return {
      ...user,
      wallet: user.wallet || { realBalance: 0, coinBalance: 0 },
      // 覆盖原始 devices，确保前端拿到的是带有 isBanned 的数据
      devices: enrichedDevices.slice(0, 5),
    };
  }

  /**
   * 更新用户状态（封号/解冻）
   * @param id
   * @param dto
   */
  async updateUserStatus(id: string, dto: UpdateUserStatusDto) {
    const { status } = dto;
    try {
      return await this.prismaService.user.update({
        where: { id },
        data: {
          status,
        },
      });
    } catch (error: any) {
      if (error.code === 'P2025') {
        throw new NotFoundException(`User with ID ${id} not found`);
      }
    }
  }

  /**
   * 获取用户设备列表及其封禁状态
   * @param userId
   */
  async getUserDevices(userId: string) {
    // 查询用户的所有设备信息
    const devices = await this.prismaService.userDevice.findMany({
      where: { userId },
      orderBy: { lastActiveAt: 'desc' },
    });

    // 2. 查黑名单表 (取出所有被拉黑的 IDs)
    // 优化：收集所有 deviceId 一次性查询'
    const deviceIds = devices.map((d) => d.deviceId);
    const blacklisted = await this.prismaService.deviceBlacklist.findMany({
      where: { deviceId: { in: deviceIds } },
      select: {
        deviceId: true,
        reason: true,
      },
    });

    // 3. 内存匹配，给前端返回 isBanned 标记
    const blacklistMap = new Map(
      blacklisted.map((b) => [b.deviceId, b.reason]),
    );
    return devices.map((device) => ({
      ...device,
      isBanned: blacklistMap.has(device.deviceId),
      banReason: blacklistMap.get(device.deviceId) || null,
    }));
  }

  /**
   * 设备拉黑
   * @param dto
   * @param adminId
   */
  async banDevice(dto: BanDeviceDto, adminId: string) {
    const { deviceId, reason } = dto;
    try {
      await this.prismaService.deviceBlacklist.create({
        data: {
          deviceId: deviceId,
          reason: reason,
          // operator: adminId // 如果表里加了操作人字段
        },
      });

      // 2.  同步写入 Redis 黑名单集合 (对应 DeviceSecurityService 的第一道防线)
      await this.redisService.sadd('security:device:blacklist', deviceId);

      // 3. 清理该设备可能的“活跃缓存” (强制该设备下次请求必须走安全校验)
      // 因为 active 缓存 Key 包含 userId，如果是管理员手动封禁，
      // 最稳妥的方法是配合黑名单拦截，或者清理该设备相关的模式匹配 Key
      const pattern = `security:device:active:*:${deviceId}`;
      const keys = await this.redisService.keys(pattern);
      if (keys.length > 0) {
        await this.redisService.del(...keys);
      }
      return { success: true };
    } catch (error: any) {
      if (error.code === 'P2002') {
        await this.redisService.sadd('security:device:blacklist', deviceId);
        throw new ConflictException('Device is already banned');
      }
      throw error;
    }
  }

  /**
   * 设备解封
   * @param deviceId
   */
  async unbanDevice(deviceId: string) {
    try {
      // 1) 从黑名单删除 + 重置该设备历史绑定（频率从 0 重新计算）
      const [, resetBindings] = await this.prismaService.$transaction([
        this.prismaService.deviceBlacklist.delete({
          where: { deviceId },
        }),
        this.prismaService.userDevice.deleteMany({
          where: { deviceId },
        }),
      ]);

      // 关键：从 Redis 黑名单集合中移除
      // 必须与 DeviceSecurityService 中使用的 Key 保持一致
      await this.redisService.srem('security:device:blacklist', deviceId);

      // 2) 清理该设备活跃缓存，确保下次登录按“新设备”重新开始
      const pattern = `security:device:active:*:${deviceId}`;
      const keys = await this.redisService.keys(pattern);
      if (keys.length > 0) {
        await this.redisService.del(...keys);
      }

      return { success: true, resetBindings: resetBindings.count };
    } catch (error: any) {
      if (error.code === 'P2025') {
        throw new NotFoundException('Device is not banned');
      }
      throw error;
    }
  }
}
