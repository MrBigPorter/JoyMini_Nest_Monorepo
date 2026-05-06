import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { GroupCreateDto } from '@api/common/group/dto/group-create.dto';
import { GroupService } from '@api/common/group/group.service';
import { GroupListForTreasureDto } from '@api/common/group/dto/group-list-for-treasure.dto';
import { ApiOkResponse } from '@nestjs/swagger';
import { GroupListForTreasureResponseDto } from '@api/common/group/dto/group-list-for-treasure-response.dto';
import { GroupMembersDto } from '@api/common/group/dto/group-members.dto';
import { GroupMembersResponseDto } from '@api/common/group/dto/group-members-response.dto';
import { plainToInstance } from 'class-transformer';
import { GroupForTreasureItemDto } from '@api/common/group/dto/group-for-treasure-item.dto';
import { GroupDetailResponseDto } from '@api/common/group/dto/group-detail.response.dto';
import { Roles } from '../auth/roles.decorator';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Role } from '@lucky/shared';

@Controller('admin/groups')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class GroupController {
  constructor(private readonly groupService: GroupService) {}

  @Get('list')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOkResponse({ type: GroupListForTreasureResponseDto })
  async list(@Query() query: GroupListForTreasureDto) {
    const data = await this.groupService.listGroupForTreasure(null, query);
    return {
      ...data,
      list: plainToInstance(GroupForTreasureItemDto, data.list),
    };
  }

  @Get(':groupId')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOkResponse({ type: GroupDetailResponseDto })
  async getGroupDetail(@Param('groupId') groupId: string) {
    const data = await this.groupService.getGroupDetail(groupId);
    return plainToInstance(GroupDetailResponseDto, data);
  }
}
