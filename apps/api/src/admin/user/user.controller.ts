import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserService } from '@api/admin/user/user.service';
import { AdminListDto } from '@api/admin/user/dto/admin-list.dto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { PermissionsGuard } from '@api/common/guards/permissions.guard';
import { OpAction, OpModule, Role } from '@lucky/shared';
import { UpdateAdminDto } from '@api/admin/user/dto/update-admin.dto';
import { CurrentUserId } from '@api/common/decorators/user.decorator';
import { CreateAdminDto } from '@api/admin/user/dto/create-admin.dto';
import { RequirePermission } from '@api/common/decorators/require-permission.decorator';

@ApiTags('Admin User Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  /**
   * Get a paginated list of admin users with optional filters
   * @param query
   * @returns Paginated list of admin users
   *
   */
  @RequirePermission(OpModule.USER, OpAction.USER.VIEW)
  @Get('list')
  async adminList(@Query() query: AdminListDto) {
    return this.userService.adminList(query);
  }

  /**
   * Update an existing admin user
   * @param id
   * @param updateAdminDto
   * @param userId
   */
  @RequirePermission(OpModule.USER, OpAction.USER.UPDATE)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateAdminDto: UpdateAdminDto,
    @CurrentUserId() userId: string,
  ) {
    return this.userService.update(id, updateAdminDto, userId);
  }

  /**
   * Create a new admin user
   * @param dto
   * @returns Promise<User>
   */
  @Post('create')
  @RequirePermission(OpModule.USER, OpAction.USER.CREATE)
  async create(@Body() dto: CreateAdminDto) {
    return this.userService.create(dto);
  }

  /**
   * Delete an admin user by ID
   * @param id
   * @return Promise<void>
   */
  @Delete(':id')
  @RequirePermission(OpModule.USER, OpAction.USER.DELETE)
  async remove(@Param('id') id: string) {
    return this.userService.remove(id);
  }

  /**
   * Get roles summary — role descriptions, permission list, active user counts
   * Guarded by SYSTEM:VIEW (read-only, accessible by VIEWER)
   */
  @Get('roles-summary')
  @RequirePermission(OpModule.SYSTEM, OpAction.SYSTEM.VIEW)
  async getRolesSummary() {
    return this.userService.getRolesSummary();
  }
}
