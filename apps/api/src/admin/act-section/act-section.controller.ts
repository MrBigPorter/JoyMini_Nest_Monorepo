import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { PermissionsGuard } from '@api/common/guards/permissions.guard';
import { ActSectionResponseDto } from '@api/admin/act-section/dto/act-section-response.dto';
import { CreateActSectionDto } from '@api/admin/act-section/dto/create-act-section.dto';
import { ActSectionService } from '@api/admin/act-section/act-section.service';
import { plainToInstance } from 'class-transformer';
import { QueryActSectionDto } from '@api/admin/act-section/dto/query-act-section.dto';
import { UpdateActSectionDto } from '@api/admin/act-section/dto/update-act-section.dto';
import { BindSectionItemDto } from '@api/admin/act-section/dto/bind-section-item.dto';
import { RequirePermission } from '@api/common/decorators/require-permission.decorator';

const MARKETING_MODULE = 'marketing_management';
const MARKETING_VIEW = 'view_activity';
const MARKETING_CREATE = 'create_activity';
const MARKETING_UPDATE = 'update_activity';
const MARKETING_DELETE = 'delete_activity';

const toTimestamp = (
  value: Date | string | number | null | undefined,
): number => (value ? new Date(value).getTime() : 0);

@ApiTags('admin Act Section Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ClassSerializerInterceptor)
@Controller('admin/act-sections')
export class ActSectionController {
  constructor(private readonly sectionService: ActSectionService) {}

  /**
   * Create a new act section
   * @param dto
   * @returns {Promise<ActSectionResponseDto>}
   */
  @Post('create')
  @RequirePermission(MARKETING_MODULE, MARKETING_CREATE)
  @ApiOkResponse({ type: ActSectionResponseDto })
  async create(@Body() dto: CreateActSectionDto) {
    const data = await this.sectionService.create(dto);
    return plainToInstance(ActSectionResponseDto, data);
  }

  /**
   * Get act section list
   * @param query
   * @returns {Promise<ActSectionResponseDto[]>}
   */
  @Get('list')
  @RequirePermission(MARKETING_MODULE, MARKETING_VIEW)
  @ApiOkResponse({ type: [ActSectionResponseDto] })
  async findAll(@Query() query: QueryActSectionDto) {
    const result = await this.sectionService.findAll(query);
    const cleanList = result.list.map((section) => {
      const cleanItems = section.items
        .map((item) => {
          const t = item.treasure;
          if (!t) return null;
          return {
            treasureId: t.treasureId,
            treasureName: t.treasureName,
            productName: t.productName,
            treasureCoverImg: t.treasureCoverImg,
            state: t.state,

            // --- 关键：Decimal 转 Number (解决报错的核心) ---
            costAmount: t.costAmount ? Number(t.costAmount) : 0,
            unitAmount: t.unitAmount ? Number(t.unitAmount) : 0,
            seqShelvesQuantity: t.seqShelvesQuantity,
            seqBuyQuantity: t.seqBuyQuantity,
            buyQuantityRate: t.buyQuantityRate ? Number(t.buyQuantityRate) : 0,

            // --- 时间处理 ---
            createdAt: toTimestamp(t.createdAt),
            updatedAt: toTimestamp(t.updatedAt),
            categories: [],
          };
        })
        .filter((i): i is NonNullable<typeof i> => i !== null);

      return {
        ...section,
        startAt: toTimestamp(section.startAt),
        endAt: toTimestamp(section.endAt),
        items: cleanItems || [],
      };
    });

    return {
      list: cleanList,
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
    };
  }

  /**
   * Get act section by id
   * @param id
   * @returns {Promise<ActSectionResponseDto>}
   */
  @Get(':id')
  @RequirePermission(MARKETING_MODULE, MARKETING_VIEW)
  @ApiOkResponse({ type: ActSectionResponseDto })
  async findOne(@Param('id') id: string) {
    return await this.sectionService.findOne(id);
  }

  /**
   * Update act section by id
   * @param id
   * @param dto
   * @returns {Promise<ActSectionResponseDto>}
   */
  @Patch(':id')
  @RequirePermission(MARKETING_MODULE, MARKETING_UPDATE)
  @ApiOkResponse({ type: ActSectionResponseDto })
  async update(@Param('id') id: string, @Body() dto: UpdateActSectionDto) {
    const data = await this.sectionService.update(id, dto);
    return plainToInstance(ActSectionResponseDto, data);
  }

  /**
   * Delete act section by id
   * @param id
   * @returns {Promise<ActSectionResponseDto>}
   */
  @Delete(':id')
  @RequirePermission(MARKETING_MODULE, MARKETING_DELETE)
  @ApiOkResponse({ type: ActSectionResponseDto })
  async remove(@Param('id') id: string) {
    const data = await this.sectionService.remove(id);
    return plainToInstance(ActSectionResponseDto, data);
  }

  /**
   * Bind treasures to act section
   * @param id
   * @param dto
   * @returns {Promise<ActSectionResponseDto>}
   */
  @Post(':id/bind')
  @RequirePermission(MARKETING_MODULE, MARKETING_UPDATE)
  @ApiOkResponse({ type: ActSectionResponseDto })
  async bindTreasures(
    @Param('id') id: string,
    @Body() dto: BindSectionItemDto,
  ) {
    const data = await this.sectionService.bindTreasures(id, dto);
    return plainToInstance(ActSectionResponseDto, data);
  }

  /**
   * Unbind treasure from act section
   * @param id
   * @param treasureId
   * @returns {Promise<ActSectionResponseDto>}
   */
  @Delete(':id/unbind/:treasureId')
  @RequirePermission(MARKETING_MODULE, MARKETING_UPDATE)
  @ApiOkResponse({ type: ActSectionResponseDto })
  async unbindTreasure(
    @Param('id') id: string,
    @Param('treasureId') treasureId: string,
  ) {
    const data = await this.sectionService.unbindTreasure(id, treasureId);
    return plainToInstance(ActSectionResponseDto, data);
  }
}
