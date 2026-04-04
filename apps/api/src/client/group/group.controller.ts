import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { GroupService } from '@api/common/group/group.service';
import { GROUP_STATUS } from '@lucky/shared';
import { ApiOkResponse } from '@nestjs/swagger';
import { GroupListForTreasureResponseDto } from '@api/common/group/dto/group-list-for-treasure-response.dto';
import { plainToInstance } from 'class-transformer';
import { GroupForTreasureItemDto } from '@api/common/group/dto/group-for-treasure-item.dto';
import { GroupListForTreasureDto } from '@api/client/group/dto/group-list-for-treasure.dto';
import { GroupDetailResponseDto } from '@api/common/group/dto/group-detail.response.dto';
import { CurrentUserId } from '@api/common/decorators/user.decorator';
import { OptionalJwtAuthGuard } from '@api/common/jwt/option-jwt.guard';

@Controller('client/groups')
export class GroupClientController {
  constructor(private readonly groupService: GroupService) {}

  /**
   * 商品团列表（App 专用，只看进行中、且没过期的团）
   * @param userId
   * @param query
   */
  @Get('list')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOkResponse({ type: GroupListForTreasureResponseDto })
  async list(
    @Query() query: GroupListForTreasureDto,
    @CurrentUserId() userId: string | null,
  ) {
    //  强制设置：App 只能看进行中、且没过期的
    // 即使前端黑客传了 ?status=3，这里也会被覆盖成 1

    const dto = {
      ...query,
      status: GROUP_STATUS.ACTIVE,
    };

    const data = await this.groupService.listGroupForTreasure(userId, dto);

    return {
      ...data,
      list: plainToInstance(GroupForTreasureItemDto, data.list),
    };
  }

  /**
   * 获取团详情
   * @param groupId
   */
  @Get(':groupId')
  @ApiOkResponse({ type: GroupDetailResponseDto })
  async getGroupDetail(@Param('groupId') groupId: string) {
    const data = await this.groupService.getGroupDetail(groupId);
    return plainToInstance(GroupDetailResponseDto, data);
  }
}
