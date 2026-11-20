import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@lucky/shared';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { FlowStateVersioningService } from '@api/client/ai-customer/flow-versioning/flow-state-versioning.service';
import {
  BindFlowDto,
  RegisterFlowDefinitionDto,
  RollbackStateDto,
  SwitchFlowDefinitionDto,
} from './dto/flow-versioning.dto';

@ApiTags('Admin - AI Flow Versioning')
@Controller('admin/ai-flows')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class FlowVersioningController {
  constructor(private readonly flowVersioning: FlowStateVersioningService) {}

  @Get('definitions')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: '流程定义版本列表' })
  async listDefinitions(@Query('flowType') flowType?: string) {
    return this.flowVersioning.listDefinitions(flowType);
  }

  @Post('definitions')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: '登记流程定义版本（同内容幂等）' })
  async registerDefinition(@Body() dto: RegisterFlowDefinitionDto) {
    return this.flowVersioning.registerDefinition(dto);
  }

  @Get('bindings')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: '会话绑定的流程版本' })
  async listBindings(@Query('conversationId') conversationId: string) {
    return this.flowVersioning.listBindings(conversationId);
  }

  @Post('bind')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '把会话绑定到当前最新版本（已绑定则保持不变）' })
  async bind(@Body() dto: BindFlowDto) {
    return this.flowVersioning.bindLatest(dto);
  }

  @Post('switch')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '安全切换到目标定义版本' })
  async switch(@Body() dto: SwitchFlowDefinitionDto) {
    return this.flowVersioning.switchDefinition(dto);
  }

  @Post('rollback-definition')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '回滚定义绑定指针（不撤销业务副作用）' })
  async rollbackDefinition(@Body() dto: SwitchFlowDefinitionDto) {
    return this.flowVersioning.switchDefinition(dto, 'ROLLBACK_DEFINITION');
  }

  @Post('rollback-state')
  @Roles(Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '状态回滚到指定 checkpoint（不撤销业务副作用）' })
  async rollbackState(@Body() dto: RollbackStateDto) {
    return this.flowVersioning.rollbackState(dto);
  }
}
