import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import {
  AdminQueryAddressDto,
  AdminUpdateAddressDto,
} from '@api/admin/address/dto/admin-address.dto';
import { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { RegionService } from '@api/common/region/region.service';

@Injectable()
export class AddressService {
  constructor(
    private prismaService: PrismaService,
    private regionService: RegionService,
  ) {}

  /**
   * Admin 获取用户地址列表，支持多条件筛选
   * @param dto
   */
  async list(dto: AdminQueryAddressDto) {
    const { userId, page, pageSize, phone, province, keyword } = dto;
    const skip = (page - 1) * pageSize;

    const whereConditions: Prisma.UserAddressWhereInput = {};

    if (phone) {
      whereConditions.phone = { contains: phone };
    }
    if (province) {
      whereConditions.province = { contains: province };
    }
    // userId 和 keyword 都是可选的筛选条件，如果提供了就添加到查询条件中
    if (userId) {
      whereConditions.userId = userId;
    }
    if (keyword) {
      whereConditions.OR = [
        { firstName: { contains: keyword } },
        { lastName: { contains: keyword } },
        { phone: { contains: keyword } },
      ];
    }

    const [total, list] = await this.prismaService.$transaction([
      this.prismaService.userAddress.count({ where: whereConditions }),
      this.prismaService.userAddress.findMany({
        where: whereConditions,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' }, //通常按时间倒序看最新的
      }),
    ]);

    return {
      page,
      pageSize,
      total,
      list,
    };
  }

  /**
   * Admin 更新用户地址信息
   * @param addressId
   * @param dto
   */
  async update(addressId: string, dto: AdminUpdateAddressDto) {
    const address = await this.prismaService.userAddress.findUnique({
      where: { addressId },
      select: {
        userId: true,
      },
    });
    if (!address) {
      throw new BadRequestException('Address not found');
    }

    const geo = await this.regionService.validateAndGetGeoInfo(
      dto.provinceId,
      dto.cityId,
      dto.barangayId,
    );

    return this.prismaService.$transaction(async (ctx) => {
      // if isDefault is being set to true, unset other default addresses for the user
      if (dto.isDefault === 1) {
        await ctx.userAddress.updateMany({
          where: {
            userId: address?.userId,
            isDefault: 1,
            addressId: { not: addressId },
          },
          data: { isDefault: 0 },
        });
      }

      // update the address
      return ctx.userAddress.update({
        where: { addressId },
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          ...(geo && {
            province: geo.province,
            city: geo.city,
            barangay: geo.barangay,
            postalCode: geo.postalCode,
          }),
          fullAddress: dto.fullAddress,
          isDefault: dto.isDefault,
        },
      });
    });
  }

  /**
   * Admin 删除用户地址
   * @param addressId
   */
  async delete(addressId: string) {
    try {
      await this.prismaService.userAddress.delete({
        where: { addressId },
      });
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new BadRequestException('Address not found');
        }
      }
      throw error;
    }
  }

  /**
   * Admin 获取用户地址详情
   * @param addressId
   */
  async detail(addressId: string) {
    const address = await this.prismaService.userAddress.findUnique({
      where: { addressId },
      include: {
        user: {
          select: {
            nickname: true,
            phone: true,
          },
        },
      },
    });

    if (!address) {
      throw new BadRequestException('Address not found');
    }
    return address;
  }
}
