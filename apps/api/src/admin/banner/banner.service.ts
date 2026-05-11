import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { CreateBannerDto } from '@api/admin/banner/dto/create-banner.dto';
import { BANNER_STATE, BANNER_VALID_STATE, JUMP_CATE } from '@lucky/shared';
import { QueryBannerDto } from '@api/admin/banner/dto/query-banner.dto';
import { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { UpdateBannerDto } from '@api/admin/banner/dto/update-banner.dto';

@Injectable()
export class BannerService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create a new banner
   * @param dto
   * @returns {Promise<any>}
   */
  async create(dto: CreateBannerDto) {
    if (dto.jumpCate === JUMP_CATE.TREASURE && !dto.relatedTitleId) {
      throw new BadRequestException(
        'Related title ID must be provided when jump category is TREASURE',
      );
    }

    if (dto.jumpCate === JUMP_CATE.EXTERNAL && !dto.jumpUrl) {
      throw new BadRequestException(
        'Jump URL must be provided when jump category is EXTERNAL LINK',
      );
    }

    return this.prisma.banner.create({
      data: {
        title: dto.title,
        bannerImgUrl: dto.bannerImgUrl,
        blurhash: dto.blurhash,
        fileType: dto.fileType,
        bannerCate: dto.bannerCate,
        jumpCate: dto.jumpCate,
        jumpUrl: dto.jumpUrl,
        sortOrder: dto.sortOrder,
        relatedTitleId: dto.relatedTitleId,
        activityAtStart: dto.activityAtStart,
        activityAtEnd: dto.activityAtEnd,
        state: BANNER_STATE.ACTIVE,
        validState: BANNER_VALID_STATE.VALID,
      },
    });
  }

  /**
   * Get banner list with pagination
   * @param dto
   * @returns {Promise<{list: any[], pageSize: number, page: number, total: number}>}
   */
  async findAll(dto: QueryBannerDto) {
    const { page, pageSize, bannerCate, title } = dto;
    const skip = (page - 1) * pageSize;

    const whereCondition: Prisma.BannerWhereInput = {};
    if (bannerCate) {
      whereCondition.bannerCate = bannerCate;
    }

    if (title) {
      whereCondition.title = { contains: title };
    }

    const [total, list] = await this.prisma.$transaction([
      this.prisma.banner.count(),
      this.prisma.banner.findMany({
        where: whereCondition,
        skip,
        take: pageSize,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      }),
    ]);

    return { list, pageSize, page, total };
  }

  /**
   * Get a single banner by id
   * @param id
   * @returns {Promise<any>}
   */
  async findOne(id: string) {
    const banner = await this.prisma.banner.findUnique({
      where: { id },
    });

    if (!banner) {
      throw new NotFoundException(`Banner with id ${id} not found`);
    }

    return banner;
  }

  /**
   * Update a banner by id
   * @param id
   * @param dto
   */
  async update(id: string, dto: UpdateBannerDto) {
    const banner = await this.findOne(id);

    try {
      return this.prisma.banner.update({
        where: { id },
        data: {
          ...dto,
        },
      });
    } catch (error: unknown) {
      if (error instanceof PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new NotFoundException(`Banner with id ${id} not found`);
        }
      }
      throw error;
    }
  }

  /**
   * Update banner state
   * @param id
   * @param state
   */
  async updateState(id: string, state: number) {
    const banner = await this.findOne(id);

    if (!banner) {
      throw new NotFoundException(`Banner with id ${id} not found`);
    }

    return this.prisma.banner.update({
      where: { id },
      data: {
        state,
      },
    });
  }

  /**
   * Delete a banner by id
   * @param id
   */
  async remove(id: string) {
    const banner = await this.findOne(id);
    if (banner.state === BANNER_STATE.ACTIVE) {
      throw new BadRequestException(
        `Cannot delete an active banner, deactivate it first`,
      );
    }

    return this.prisma.banner.delete({
      where: { id },
    });
  }
}
