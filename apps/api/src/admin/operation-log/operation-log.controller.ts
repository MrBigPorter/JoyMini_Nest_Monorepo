import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { OperationLogService } from './operation-log.service';
import { QueryOperationLogDto } from './dto/query-operation-log.dto';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@lucky/shared';

@Controller('admin/operation-logs')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class OperationLogController {
  constructor(private readonly operationLogService: OperationLogService) {}

  @Get('list')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  async getList(@Query() query: QueryOperationLogDto) {
    return this.operationLogService.getList(query);
  }
}
