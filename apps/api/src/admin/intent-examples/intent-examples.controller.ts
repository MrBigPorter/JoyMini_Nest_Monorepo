import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiParam,
} from '@nestjs/swagger';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@lucky/shared';

import { IntentExamplesService } from './intent-examples.service';
import { CreateIntentExamplesDto } from './dto/create-intent-examples.dto';
import { UpdateIntentExamplesDto } from './dto/update-intent-examples.dto';
import { TestIntentClassificationDto } from './dto/test-intent-classification.dto';
import {
  IntentExampleGroupResponseDto,
  UpdateIntentExamplesResponseDto,
  TestClassificationResponseDto,
} from './dto/intent-examples-response.dto';

@ApiTags('Admin Intent Examples')
@Controller('admin/intent-examples')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class IntentExamplesController {
  constructor(private readonly intentExamplesService: IntentExamplesService) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: 'Get all domains with their example sentences' })
  @ApiOkResponse({ type: [IntentExampleGroupResponseDto] })
  async getAll(): Promise<IntentExampleGroupResponseDto[]> {
    return this.intentExamplesService.getAll();
  }

  @Get(':domain')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: 'Get example sentences for a specific domain' })
  @ApiOkResponse({ type: IntentExampleGroupResponseDto })
  @ApiParam({ name: 'domain', description: 'Intent domain name' })
  async getByDomain(
    @Param('domain') domain: string,
  ): Promise<IntentExampleGroupResponseDto> {
    return this.intentExamplesService.getByDomain(domain);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a new intent domain with example sentences (triggers embedding)',
  })
  @ApiCreatedResponse({ type: UpdateIntentExamplesResponseDto })
  async createDomain(
    @Body() dto: CreateIntentExamplesDto,
  ): Promise<UpdateIntentExamplesResponseDto> {
    return this.intentExamplesService.createDomain(
      dto.domain,
      dto.sentences,
      // TODO: extract admin user ID from request context
    );
  }

  @Put(':domain')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Update example sentences for a domain (triggers re-embedding). Supports append/replace mode.',
  })
  @ApiOkResponse({ type: UpdateIntentExamplesResponseDto })
  async updateDomain(
    @Param('domain') domain: string,
    @Body() dto: UpdateIntentExamplesDto,
  ): Promise<UpdateIntentExamplesResponseDto> {
    return this.intentExamplesService.updateDomain(
      domain,
      dto.sentences,
      dto.mode ?? 'replace',
      // TODO: extract admin user ID from request context
    );
  }

  @Post(':domain/reindex')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Re-generate embeddings for a domain (e.g. after model change)',
  })
  @ApiOkResponse({ type: UpdateIntentExamplesResponseDto })
  async reindexDomain(
    @Param('domain') domain: string,
  ): Promise<UpdateIntentExamplesResponseDto> {
    return this.intentExamplesService.reindexDomain(domain);
  }

  @Post('test')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Test intent classification with a sample input',
  })
  @ApiOkResponse({ type: TestClassificationResponseDto })
  async testClassification(
    @Body() dto: TestIntentClassificationDto,
  ): Promise<TestClassificationResponseDto> {
    return this.intentExamplesService.testClassification(dto.input);
  }
}
