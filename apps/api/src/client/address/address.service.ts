import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import {
  CreateAddressDto,
  QueryAddressListDto,
  UpdateAddressDto,
} from '@api/client/address/dto/address.dto';
import { isPrismaNotFoundError } from '@api/common/prisma/prisma-error';
import { RegionService } from '@api/common/region/region.service';

@Injectable()
export class AddressService {
  constructor(
    private prismaService: PrismaService,
    private regionService: RegionService,
  ) {}

  /**
   * Resolve province/city/barangay text names to numeric IDs.
   * Used by the AI agent tool to convert user-provided region names to DB IDs.
   * Uses case-insensitive contains matching.
   */
  async resolveGeoIds(
    provinceName: string,
    cityName: string,
    barangayName: string,
  ): Promise<{
    provinceId: number;
    cityId: number;
    barangayId: number;
  }> {
    const province = await this.prismaService.province.findFirst({
      where: {
        provinceName: { contains: provinceName, mode: 'insensitive' },
        status: 1,
      },
    });
    if (!province) {
      throw new BadRequestException(
        `Proview "${provinceName}" not found. Available provinces: Metro Manila, Cavite, Laguna, etc.`,
      );
    }

    const city = await this.prismaService.city.findFirst({
      where: {
        provinceId: province.provinceId,
        cityName: { contains: cityName, mode: 'insensitive' },
        status: 1,
      },
    });
    if (!city) {
      throw new BadRequestException(
        `City "${cityName}" not found in ${province.provinceName}.`,
      );
    }

    const barangay = await this.prismaService.barangay.findFirst({
      where: {
        cityId: city.cityId,
        barangayName: { contains: barangayName, mode: 'insensitive' },
        status: 1,
      },
    });
    if (!barangay) {
      throw new BadRequestException(
        `Barangay "${barangayName}" not found in ${city.cityName}.`,
      );
    }

    return {
      provinceId: province.provinceId,
      cityId: city.cityId,
      barangayId: barangay.barangayId,
    };
  }

  /**
   * Create a new address for the user.
   * @param userId
   * @param dto
   */
  async create(userId: string, dto: CreateAddressDto) {
    // check count of addresses for the user,litmit to 20
    const count = await this.prismaService.userAddress.count({
      where: { userId: userId },
    });
    if (count >= 20) {
      throw new BadRequestException('Address limit reached (20 addresses max)');
    }

    // Validate geographical info
    const geo = await this.regionService.validateAndGetGeoInfo(
      dto.provinceId,
      dto.cityId,
      dto.barangayId,
    );

    // Create address, update with geo info
    return this.prismaService.$transaction(async (ctx) => {
      // If isDefault is true, set all other addresses to false
      const isDefault = dto.isDefault || count === 0 ? 1 : 0;

      if (isDefault === 1) {
        // set all other addresses to false first
        await ctx.userAddress.updateMany({
          where: {
            userId: userId,
            isDefault: 1,
          },
          data: {
            isDefault: 0,
          },
        });
      }

      // create the new default address
      return ctx.userAddress.create({
        data: {
          userId: userId,
          firstName: dto.firstName ?? null,
          lastName: dto.lastName ?? null,
          contactName: dto.contactName,
          phone: dto.phone,
          provinceId: dto.provinceId,
          cityId: dto.cityId,
          barangayId: dto.barangayId,
          province: geo.province,
          city: geo.city,
          barangay: geo.barangay,
          postalCode: dto.postalCode ?? geo.postalCode,
          fullAddress: dto.fullAddress,
          label: dto.label,
          isDefault: isDefault,
        },
      });
    });
  }

  /**
   * Update an existing address for the user.
   * @param userId
   * @param addressId
   * @param dto
   */
  async update(userId: string, addressId: string, dto: UpdateAddressDto) {
    // Validate geographical info
    const geo = await this.regionService.validateAndGetGeoInfo(
      dto.provinceId,
      dto.cityId,
      dto.barangayId,
    );

    return this.prismaService.$transaction(async (ctx) => {
      try {
        // If isDefault is true, set all other addresses to false
        const isDefault = dto.isDefault ? 1 : 0;
        if (dto.isDefault) {
          // set all other addresses to false first
          await ctx.userAddress.updateMany({
            where: {
              userId: userId,
              addressId: { not: addressId }, // exclude current address
              isDefault: 1,
            },
            data: {
              isDefault: 0,
            },
          });
        }

        // Update address
        // 必须 await：直接 return 一个 rejected promise 时，下面的 catch
        // 接不到 P2025，会漏成 500（delete 的老写法就是这个问题）。
        return await ctx.userAddress.update({
          where: {
            addressId,
            userId,
          },
          data: {
            firstName: dto.firstName ?? null,
            lastName: dto.lastName ?? null,
            contactName: dto.contactName,
            phone: dto.phone,
            provinceId: dto.provinceId,
            cityId: dto.cityId,
            barangayId: dto.barangayId,
            province: geo.province,
            city: geo.city,
            barangay: geo.barangay,
            postalCode: dto.postalCode ?? geo.postalCode,
            fullAddress: dto.fullAddress,
            label: dto.label,
            isDefault: isDefault,
          },
        });
      } catch (error: unknown) {
        // 只认错误码：跨 runtime 的 instanceof 判定在生产会失效（见 prisma-error.ts）
        if (isPrismaNotFoundError(error)) {
          throw new BadRequestException('Address not found');
        }
        throw error;
      }
    });
  }

  /**
   * Delete an address for the user.
   *
   * 用 deleteMany + count 而不是 delete + 捕获 P2025：
   *   - 返回值就是「删掉了几条」，语义明确，不依赖异常控制流；
   *   - where 同时带 userId，越权删除（别人的 addressId）与「不存在」同样返回 0，
   *     不会把记录删掉，也不泄露地址归属。
   *
   * @param userId 当前登录用户（来自 JWT，不来自请求参数）
   * @param addressId 地址 ID
   */
  async delete(userId: string, addressId: string) {
    const result = await this.prismaService.userAddress.deleteMany({
      where: {
        addressId,
        userId,
      },
    });

    if (result.count === 0) {
      throw new BadRequestException('Address not found');
    }

    return true;
  }

  /**
   * List addresses for the user with pagination.
   * @param userId
   * @param dto
   */
  async list(userId: string, dto: QueryAddressListDto) {
    const { page = 1, pageSize = 10 } = dto;

    const skip = (page - 1) * pageSize;

    const [total, list] = await this.prismaService.$transaction([
      this.prismaService.userAddress.count({
        where: { userId: userId },
      }),
      this.prismaService.userAddress.findMany({
        where: { userId: userId },
        skip,
        take: pageSize,
        orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
        select: {
          addressId: true,
          firstName: true,
          lastName: true,
          contactName: true,
          phone: true,
          province: true,
          city: true,
          barangay: true,
          postalCode: true,
          fullAddress: true,
          label: true,
          isDefault: true,
          createdAt: true,
          updatedAt: true,
          provinceId: true,
          cityId: true,
          barangayId: true,
        },
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
   * Get details of a specific address for the user.
   * @param userId
   * @param addressId
   */
  async detail(userId: string, addressId: string) {
    const address = await this.prismaService.userAddress.findUnique({
      where: {
        addressId,
        userId,
      },
    });

    if (!address) {
      throw new BadRequestException('Address not found');
    }

    return address;
  }
}
