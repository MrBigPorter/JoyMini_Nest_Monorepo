import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminLuckyDrawService } from './lucky-draw.service';
import { CreateActivityDto } from './dto/create-activity.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';
import { CreatePrizeDto } from './dto/create-prize.dto';
import { UpdatePrizeDto } from './dto/update-prize.dto';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@lucky/shared';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PaginateDto } from '@api/common/dto/paginate.dto';

@ApiTags('Admin - Lucky Draw Management')
@ApiBearerAuth()
@Controller('admin/lucky-draw')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class AdminLuckyDrawController {
  constructor(private readonly service: AdminLuckyDrawService) {}

  // --- Activities ---

  @Get('activities')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR)
  @ApiOperation({ summary: 'List all lucky draw activities' })
  listActivities(@Query() paginateDto: PaginateDto) {
    return this.service.listActivities(paginateDto);
  }

  @Get('activities/:id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR)
  @ApiOperation({ summary: 'Get a single activity by ID' })
  getActivity(@Param('id') id: string) {
    return this.service.getActivity(id);
  }

  @Post('activities')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR)
  @ApiOperation({ summary: 'Create a new lucky draw activity' })
  createActivity(@Body() dto: CreateActivityDto) {
    return this.service.createActivity(dto);
  }

  @Patch('activities/:id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR)
  @ApiOperation({ summary: 'Update an existing activity' })
  updateActivity(@Param('id') id: string, @Body() dto: UpdateActivityDto) {
    return this.service.updateActivity(id, dto);
  }

  @Delete('activities/:id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Delete an activity' })
  deleteActivity(@Param('id') id: string) {
    return this.service.deleteActivity(id);
  }

  // --- Prizes ---

  @Get('activities/:activityId/prizes')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR)
  @ApiOperation({ summary: 'List all prizes for an activity' })
  listPrizes(@Param('activityId') activityId: string) {
    return this.service.listPrizes(activityId);
  }

  @Post('prizes')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR)
  @ApiOperation({ summary: 'Create a new prize for an activity' })
  createPrize(@Body() dto: CreatePrizeDto) {
    return this.service.createPrize(dto);
  }

  @Patch('prizes/:id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR)
  @ApiOperation({ summary: 'Update an existing prize' })
  updatePrize(@Param('id') id: string, @Body() dto: UpdatePrizeDto) {
    return this.service.updatePrize(id, dto);
  }

  @Delete('prizes/:id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Delete a prize' })
  deletePrize(@Param('id') id: string) {
    return this.service.deletePrize(id);
  }

  // --- Results ---

  @Get('activities/:activityId/results')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'List draw results for an activity' })
  listResults(
    @Param('activityId') activityId: string,
    @Query() paginateDto: PaginateDto,
  ) {
    return this.service.listResults(activityId, paginateDto);
  }
}
