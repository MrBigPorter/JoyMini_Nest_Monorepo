import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@lucky/shared';
import { AiPromptService } from './ai-prompt.service';
import { CreatePromptDto } from './dto/create-prompt.dto';
import { UpdatePromptDto } from './dto/update-prompt.dto';
import { QueryPromptDto } from './dto/query-prompt.dto';
import { CreatePromptVersionDto } from './dto/create-prompt-version.dto';

@ApiTags('Admin AI Prompt')
@ApiBearerAuth()
@UseGuards(AdminJwtAuthGuard, RolesGuard)
@Controller('admin/ai-prompt')
export class AiPromptController {
  constructor(private readonly service: AiPromptService) {}

  // ---- Template & Tool APIs (must be before :id routes) ----

  @Get('templates')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR, Role.VIEWER)
  @ApiOperation({ summary: 'List all available prompt templates' })
  async getTemplates() {
    return this.service.getTemplates();
  }

  @Get('templates/:domain')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR, Role.VIEWER)
  @ApiOperation({ summary: 'Get prompt template by domain' })
  async getTemplate(@Param('domain') domain: string) {
    return this.service.getTemplate(domain);
  }

  @Get('tools')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR, Role.VIEWER)
  @ApiOperation({ summary: 'Get tools for a domain (or all tools)' })
  async getTools(@Query('domain') domain?: string) {
    return this.service.getTools(domain);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR)
  @ApiOperation({ summary: 'Create a new prompt' })
  async create(@Body() dto: CreatePromptDto) {
    return this.service.create(dto);
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR, Role.VIEWER)
  @ApiOperation({ summary: 'List prompts' })
  async list(@Query() query: QueryPromptDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR, Role.VIEWER)
  @ApiOperation({ summary: 'Get prompt detail with version history' })
  async getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Put(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR)
  @ApiOperation({ summary: 'Update prompt metadata' })
  async update(@Param('id') id: string, @Body() dto: UpdatePromptDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Archive a prompt (soft delete)' })
  async delete(@Param('id') id: string) {
    return this.service.delete(id);
  }

  // ---- Versions ----

  @Get(':id/versions')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR, Role.VIEWER)
  @ApiOperation({ summary: 'List versions for a prompt' })
  async getVersions(@Param('id') id: string) {
    return this.service.getVersions(id);
  }

  @Post(':id/versions')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR)
  @ApiOperation({ summary: 'Create a new prompt version' })
  async createVersion(
    @Param('id') id: string,
    @Body() dto: CreatePromptVersionDto,
  ) {
    return this.service.createVersion(id, dto);
  }

  @Put(':id/activate/:version')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Activate a specific version' })
  async activateVersion(
    @Param('id') id: string,
    @Param('version') version: string,
  ) {
    return this.service.activateVersion(id, parseInt(version, 10));
  }

  @Get(':id/versions/:v1/diff/:v2')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR, Role.VIEWER)
  @ApiOperation({ summary: 'Diff two versions' })
  async diffVersions(
    @Param('id') id: string,
    @Param('v1') v1: string,
    @Param('v2') v2: string,
  ) {
    return this.service.diffVersions(id, parseInt(v1, 10), parseInt(v2, 10));
  }

  // ---- Test ----

  @Post(':id/test')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR)
  @ApiOperation({ summary: 'Run a manual test against the prompt' })
  async runTest(@Param('id') id: string, @Body('testQuery') testQuery: string) {
    return this.service.runTest(id, testQuery);
  }

  // ---- Metrics ----

  @Get(':id/metrics')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR, Role.VIEWER)
  @ApiOperation({ summary: 'Get per-version metrics comparison' })
  async getMetrics(@Param('id') id: string) {
    return this.service.getMetrics(id);
  }
}
