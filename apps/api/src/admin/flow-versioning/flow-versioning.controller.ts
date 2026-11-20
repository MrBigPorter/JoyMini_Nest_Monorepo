import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@lucky/shared';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUserId } from '@api/common/decorators/user.decorator';
import { OperationLogService } from '../operation-log/operation-log.service';
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
  constructor(
    private readonly flowVersioning: FlowStateVersioningService,
    private readonly operationLog: OperationLogService,
  ) {}

  private writeLog(adminId: string, action: string, details: string) {
    void this.operationLog.log({
      adminId,
      adminName: adminId,
      module: 'ai-flows',
      action,
      details,
    });
  }

  @Get('definitions')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: '流程定义版本列表' })
  async listDefinitions(@Query('flowType') flowType?: string) {
    return this.flowVersioning.listDefinitions(flowType);
  }

  @Get('definitions/:id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: '流程定义版本详情（含 payload）' })
  async getDefinition(@Param('id') id: string) {
    return this.flowVersioning.getDefinition(id);
  }

  @Post('definitions')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: '登记流程定义版本（同内容幂等）' })
  async registerDefinition(
    @Body() dto: RegisterFlowDefinitionDto,
    @CurrentUserId() adminId: string,
  ) {
    // 操作者只来自凭证；body 里的 createdBy 不可信。
    const result = await this.flowVersioning.registerDefinition({
      ...dto,
      createdBy: adminId,
    });
    this.writeLog(
      adminId,
      'register-definition',
      `flow=${dto.flowType}, hash=${result.definitionHash}`,
    );
    return result;
  }

  @Get('audit')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: '流程绑定审计日志' })
  async listAudit(
    @Query('conversationId') conversationId?: string,
    @Query('flowType') flowType?: string,
    @Query('limit') limit?: string,
  ) {
    return this.flowVersioning.listAudit({
      conversationId,
      flowType,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
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
  async bind(@Body() dto: BindFlowDto, @CurrentUserId() adminId: string) {
    const result = await this.flowVersioning.bindLatest({
      ...dto,
      actorId: adminId,
    });
    this.writeLog(
      adminId,
      'bind',
      `conv=${dto.conversationId}, flow=${dto.flowType}`,
    );
    return result;
  }

  @Post('switch')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '安全切换到目标定义版本' })
  async switch(
    @Body() dto: SwitchFlowDefinitionDto,
    @CurrentUserId() adminId: string,
  ) {
    const result = await this.flowVersioning.switchDefinition({
      ...dto,
      actorId: adminId,
    });
    if (result.ok) {
      this.writeLog(
        adminId,
        'switch',
        `conv=${dto.conversationId}, to=${dto.toVersionId}`,
      );
    }
    return result;
  }

  @Post('rollback-definition')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '回滚定义绑定指针（不撤销业务副作用）' })
  async rollbackDefinition(
    @Body() dto: SwitchFlowDefinitionDto,
    @CurrentUserId() adminId: string,
  ) {
    const result = await this.flowVersioning.switchDefinition(
      { ...dto, actorId: adminId },
      'ROLLBACK_DEFINITION',
    );
    if (result.ok) {
      this.writeLog(
        adminId,
        'rollback-definition',
        `conv=${dto.conversationId}, to=${dto.toVersionId}`,
      );
    }
    return result;
  }

  @Post('rollback-state')
  @Roles(Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '状态回滚到指定 checkpoint（不撤销业务副作用）' })
  async rollbackState(
    @Body() dto: RollbackStateDto,
    @CurrentUserId() adminId: string,
  ) {
    const result = await this.flowVersioning.rollbackState({
      ...dto,
      actorId: adminId,
    });
    if (result.ok) {
      this.writeLog(
        adminId,
        'rollback-state',
        `conv=${dto.conversationId}, checkpoint=${dto.checkpointId}`,
      );
    }
    return result;
  }
}
