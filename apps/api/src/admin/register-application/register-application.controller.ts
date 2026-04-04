import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RegisterApplicationService } from './register-application.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { ListApplicationDto } from './dto/list-application.dto';
import { ReviewApplicationDto } from './dto/review-application.dto';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { PermissionsGuard } from '@api/common/guards/permissions.guard';
import { RolesGuard } from '@api/admin/auth/roles.guard';
import { Roles } from '@api/admin/auth/roles.decorator';
import { CurrentUserId } from '@api/common/decorators/user.decorator';
import { RealIp } from '@api/common/decorators/http.decorators';
import { Role } from '@lucky/shared';
import { Throttle } from '@nestjs/throttler';

// ─── PUBLIC: anyone can submit ────────────────────────────────────────────────
@ApiTags('Admin Register Application')
@Controller('auth/admin/apply')
export class ApplyController {
  constructor(private readonly svc: RegisterApplicationService) {}

  /** Submit a new account application (public, no JWT) */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit admin account application (public)' })
  // Throttle: max 5 attempts per 15 min per IP
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  async apply(@Body() dto: CreateApplicationDto, @RealIp() ip: string) {
    return this.svc.create(dto, ip);
  }
}

// ─── PROTECTED: SUPER_ADMIN only ─────────────────────────────────────────────
@ApiTags('Admin Register Application')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
@Controller('admin/applications')
export class ApplicationsAdminController {
  constructor(private readonly svc: RegisterApplicationService) {}

  /** Get paginated list of applications */
  @Get()
  @ApiOperation({ summary: 'List register applications (super admin only)' })
  async findAll(@Query() query: ListApplicationDto) {
    return this.svc.findAll(query);
  }

  /** Pending count for sidebar badge */
  @Get('pending-count')
  @ApiOperation({ summary: 'Get pending application count' })
  async pendingCount() {
    return this.svc.pendingCount();
  }

  /** Approve an application */
  @Patch(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve application (super admin only)' })
  async approve(@Param('id') id: string, @CurrentUserId() reviewerId: string) {
    return this.svc.approve(id, reviewerId);
  }

  /** Reject an application */
  @Patch(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject application (super admin only)' })
  async reject(
    @Param('id') id: string,
    @Body() dto: ReviewApplicationDto,
    @CurrentUserId() reviewerId: string,
  ) {
    return this.svc.reject(id, dto, reviewerId);
  }
}
