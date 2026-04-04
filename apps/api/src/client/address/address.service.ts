import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import {
  CreateAddressDto,
  QueryAddressListDto,
  UpdateAddressDto,
} from '@api/client/address/dto/address.dto';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/edge';
import { RegionService } from '@api/common/region/region.service';

@Injectable()
export class AddressService {
  constructor(
    private prismaService: PrismaService,
    private regionService: RegionService,
  ) {}

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
        return ctx.userAddress.update({
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
        if (
          error instanceof PrismaClientKnownRequestError &&
          error.code === 'P2025'
        ) {
          throw new BadRequestException('Address not found');
        }
        throw error;
      }
    });
  }

  /**
   * Delete an address for the user.
   * @param userId
   * @param addressId
   */
  async delete(userId: string, addressId: string) {
    try {
      await this.prismaService.userAddress.delete({
        where: {
          addressId,
          userId,
        },
      });
      return true;
    } catch (error: unknown) {
      if (
        error instanceof PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new BadRequestException('Address not found');
      }
      throw error;
    }
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
