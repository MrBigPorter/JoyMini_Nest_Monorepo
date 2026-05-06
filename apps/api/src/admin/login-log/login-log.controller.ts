import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { LoginLogService } from './login-log.service';
import { QueryLoginLogDto } from './dto/query-login-log.dto';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@lucky/shared';
import { maskSensitiveFields, maskName } from '@api/common/utils/data-masking';

@Controller('admin/login-logs')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class LoginLogController {
  constructor(private readonly loginLogService: LoginLogService) {}

  /** GET /v1/admin/login-logs/list — 登录日志分页列表 */
  @Get('list')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  async getList(@Query() query: QueryLoginLogDto, @Req() req: Request) {
    const result = await this.loginLogService.getList(query);
    const role = (req as any).user?.role;
    return maskSensitiveFields(result, role, {
      userNickname: maskName,
    });
  }
}
