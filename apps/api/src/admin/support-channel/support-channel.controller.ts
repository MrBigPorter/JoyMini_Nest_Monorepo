import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SupportChannelService } from './support-channel.service';
import { AdminJwtAuthGuard } from '@api/admin/auth/admin-jwt-auth.guard';
import { RolesGuard } from '@api/admin/auth/roles.guard';
import { Roles } from '@api/admin/auth/roles.decorator';
import { Role } from '@lucky/shared';
import {
  CreateSupportChannelDto,
  QuerySupportChannelsDto,
  ToggleSupportChannelDto,
  UpdateSupportChannelDto,
} from './dto/support-channel.dto';

@Controller('admin/support-channels')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class SupportChannelController {
  constructor(private readonly service: SupportChannelService) {}

  /** GET /v1/admin/support-channels */
  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  list(@Query() query: QuerySupportChannelsDto) {
    return this.service.list(query);
  }

  /** POST /v1/admin/support-channels */
  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  create(@Body() dto: CreateSupportChannelDto) {
    return this.service.create(dto);
  }

  /** PATCH /v1/admin/support-channels/:id */
  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateSupportChannelDto) {
    return this.service.update(id, dto);
  }

  /** PATCH /v1/admin/support-channels/:id/toggle */
  @Patch(':id/toggle')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  toggle(@Param('id') id: string, @Body() dto: ToggleSupportChannelDto) {
    return this.service.toggle(id, dto);
  }
}
