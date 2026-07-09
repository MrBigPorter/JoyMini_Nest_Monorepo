import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@lucky/shared';
import { HealthService, ServiceHealth } from './health.service';

@ApiTags('Admin Services')
@Controller('admin/services')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('health')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: 'Check all backend service health status' })
  async checkHealth(): Promise<{
    services: ServiceHealth[];
    allAvailable: boolean;
  }> {
    const services = await this.healthService.checkAll();
    return {
      services,
      allAvailable: services.every((s) => s.available),
    };
  }
}
