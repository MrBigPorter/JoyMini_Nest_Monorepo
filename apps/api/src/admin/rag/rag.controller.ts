import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@lucky/shared';

import { RagService } from './rag.service';
import { RagSyncService } from './rag-sync.service';
import { CreateRagDocDto } from './dto/create-rag-doc.dto';
import { UpdateRagDocDto } from './dto/update-rag-doc.dto';
import { QueryRagDocDto } from './dto/query-rag-doc.dto';
import { UploadRagDocDto } from './dto/upload-rag-doc.dto';
import { RollbackVersionDto } from './dto/rollback-version.dto';
import { SearchRagDto } from './dto/search-rag.dto';
import { JudgeRagDto } from './dto/judge-rag.dto';
import { RejectRagContentGuard } from './reject-rag-content.guard';
import { KbVersionService } from '@api/client/ai-customer/knowledge/kb-version.service';
import { RagRetrievalService } from '@api/client/ai-customer/knowledge/rag-retrieval.service';
import { CorpusFingerprintService } from '@api/common/knowledge/corpus-fingerprint.service';
import { RagFaithfulnessService } from './rag-faithfulness.service';
import {
  RagDocResponseDto,
  RagDocListResponseDto,
} from './dto/rag-doc-response.dto';

@ApiTags('Admin RAG Knowledge Base')
@Controller('admin/rag/documents')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class RagController {
  constructor(
    private readonly ragService: RagService,
    private readonly ragSyncService: RagSyncService,
    private readonly kbVersionService: KbVersionService,
    private readonly ragRetrievalService: RagRetrievalService,
    private readonly ragFaithfulnessService: RagFaithfulnessService,
    private readonly corpusFingerprintService: CorpusFingerprintService,
  ) {}

  // ==================== Retrieval Eval ====================

  /**
   * LLM-as-Judge：判断回答是否被 sources 支持（faithfulness）。
   */
  @Post('judge')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Judge RAG faithfulness (LLM-as-Judge)' })
  async judge(@Body() dto: JudgeRagDto) {
    return this.ragFaithfulnessService.judge({
      question: dto.question,
      answer: dto.answer,
      sources: dto.sources,
      expectedDocIds: dto.expectedDocIds,
      citedDocIds: dto.citedDocIds,
      repeats: dto.repeats,
    });
  }

  /**
   * 管理端知识库检索（离线评测/调试用）。
   * 与线上 AI 对话共用 RagRetrievalService，确保评测的是同一条检索链路。
   */
  @Post('search')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retrieve knowledge chunks (eval/debug)' })
  async search(@Body() dto: SearchRagDto) {
    const options = {
      domain: dto.domain,
      topK: dto.topK ?? 5,
      minScore: dto.minScore,
      useRerank: dto.rerank,
    };

    const toResponse = (r: any) => ({
      chunkId: r.chunkId,
      documentId: r.documentId,
      docId: r.docId,
      title: r.title,
      domain: r.domain,
      score: r.score,
      contentPreview: r.content.slice(0, 300),
    });

    // debug=true 才多返回分层明细；默认响应结构保持不变
    if (dto.debug) {
      const { results, debug } =
        await this.ragRetrievalService.retrieveDetailed(dto.query, options);
      return { results: results.map(toResponse), debug };
    }

    const results = await this.ragRetrievalService.retrieve(dto.query, options);
    return results.map(toResponse);
  }

  // ==================== CRUD ====================

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a knowledge document' })
  @ApiCreatedResponse({ type: RagDocResponseDto })
  async create(@Body() dto: CreateRagDocDto): Promise<RagDocResponseDto> {
    return this.ragService.create(dto);
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({
    summary:
      'List documents (paginated, filterable by domain/search/priority/isActive)',
  })
  @ApiOkResponse({ type: RagDocListResponseDto })
  async list(@Query() query: QueryRagDocDto): Promise<RagDocListResponseDto> {
    return this.ragService.list(query);
  }

  // 静态路由必须放在 `:id` 之前，否则 `/quality-stats` 会被当成文档 ID。
  @Get('quality-stats')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: 'Get quality statistics overview' })
  async getQualityStats() {
    return this.ragService.getQualityStats();
  }

  @Get('meta/domains')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: 'Get distinct domain list for filter dropdown' })
  async getDomains(): Promise<string[]> {
    return this.ragService.getDomains();
  }

  /**
   * 当前语料指纹（只读派生视图）。
   * 只覆盖正在服务的 activeVersion 内容，不返回正文，不查 Meilisearch。
   */
  @Get('meta/corpus-fingerprint')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: 'Get current corpus fingerprint (active content only)' })
  async getCorpusFingerprint() {
    return this.corpusFingerprintService.getCurrent();
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: 'Get document detail by ID' })
  @ApiOkResponse({ type: RagDocResponseDto })
  @ApiParam({ name: 'id', description: 'Document UUID' })
  async getById(@Param('id') id: string): Promise<RagDocResponseDto> {
    return this.ragService.getById(id);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @UseGuards(RejectRagContentGuard)
  @ApiOperation({ summary: 'Update document metadata (content must use upload or :id/content)' })
  @ApiOkResponse({ type: RagDocResponseDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRagDocDto,
  ): Promise<RagDocResponseDto> {
    return this.ragService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Soft delete document (sets isActive=false)' })
  @ApiParam({ name: 'id', description: 'Document UUID' })
  async delete(@Param('id') id: string): Promise<RagDocResponseDto> {
    return this.ragService.delete(id);
  }

  // ==================== Upload (drag-drop .md / .pdf) ====================
  //
  // 为什么这个上传流程不需要 OCR？
  //
  //   1. 系统只接受 .md 和 .pdf 两种格式（见 FileInterceptor 配置和 ApiBody schema）
  //   2. .md 文件是纯文本，file.buffer 直接 toString('utf-8') 即可得到内容
  //   3. .pdf 文件使用 pdf-parse 提取文本流（只读 PDF 中的文字编码，不做 OCR）
  //   4. 图片格式（.png, .jpg, .jpeg）被拒绝——因为 RAG 知识库只存文本，不存图片
  //
  //   如果未来需要支持扫描件/图片，需要：
  //     a. 修改 FileInterceptor 的 limits（可能需要更大的 size limit）
  //     b. 新增一个支持 OCR 的 TextExtractor（如集成 Tesseract.js）
  //     c. 在 RagSyncService 中注册新 extractor
  //
  // FileInterceptor（NestJS 对 multer 的封装）做的事情：
  //   1. 检查请求 Content-Type → 必须是 multipart/form-data
  //   2. 解析 multipart body → 按 boundary 分割不同的 form field
  //   3. 找到 name=file 的字段 → 读取文件内容到内存（buffer）
  //   4. 如果文件 > 10MB → 抛 PayloadTooLargeError
  //   5. 在 request 上挂载 file 对象 → 通过 @UploadedFile() 注入到参数
  //
  // Express.Multer.File 的结构：
  //   {
  //     fieldname: 'file',          // 表单字段名
  //     originalname: 'refund-policy.en.md',  // 原始文件名
  //     encoding: '7bit',           // 编码方式
  //     mimetype: 'text/markdown',  // MIME 类型（浏览器决定，不可靠）
  //     buffer: <Buffer ...>,       // 整个文件内容在内存中
  //     size: 1234,                 // 文件大小（字节）
  //   }
  //
  // ParseFilePipe 是第二道验证：
  //   第一道：FileInterceptor 的 limits.fileSize（multer 级别）
  //   第二道：MaxFileSizeValidator（NestJS Pipe 级别）
  //   双重验证是 NestJS 推荐做法，确保即使 multer 配置被误改也有兜底。
  // ====================

  @Post('upload')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
    }),
  )
  @ApiOperation({
    summary: 'Upload .md or .pdf document (drag-drop), max 10MB',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: '.md or .pdf file (max 10MB)',
        },
        domain: {
          type: 'string',
          description: 'Override domain, e.g. order, product',
        },
        locale: { type: 'string', description: 'Override locale, e.g. en, zh' },
        keywords: {
          type: 'string',
          description: 'Comma-separated keywords, e.g. refund,return',
        },
        contentType: { type: 'string', description: 'Content type override' },
        priority: {
          type: 'string',
          enum: ['P0', 'P1', 'P2'],
          description: 'Priority override',
        },
      },
    },
  })
  async upload(
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 })],
        fileIsRequired: true,
      }),
    )
    file: Express.Multer.File,
    @Body() dto: UploadRagDocDto,
  ): Promise<{ document: RagDocResponseDto; action: 'created' | 'updated' }> {
    // 调用 ragSyncService.uploadFile() 完成 7 步流程：
    //   1. Strategy 模式选择文件提取器
    //   2. 提取纯文本内容 + 元数据（纯文本操作，无 OCR）
    //   3. 合并元数据（frontmatter > overrides > 默认值）
    //   4. upsert 到 knowledge_documents 表
    //   5. 切片（RecursiveCharacterTextSplitter）
    //   6. 向量化（bge-m3 → 1024 维向量 → pgvector）
    //   7. 返回结果给前端
    return this.ragSyncService.uploadFile(file, dto);
  }

  // ==================== Chunk operations (Phase 4a) ====================

  @Get(':id/chunks')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: 'Get all chunks for a document' })
  @ApiParam({ name: 'id', description: 'Document UUID' })
  async getChunks(@Param('id') id: string) {
    return this.ragService.getChunks(id);
  }

  @Post(':id/reindex')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Re-chunk and re-embed a document (delete old + recreate)',
  })
  @ApiParam({ name: 'id', description: 'Document UUID' })
  async reindex(@Param('id') id: string) {
    return this.ragService.reindex(id);
  }

  @Post(':id/rollback')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Roll back to a previous version (flags only, no re-index)',
  })
  @ApiParam({ name: 'id', description: 'Document ID' })
  async rollbackVersion(
    @Param('id') id: string,
    @Body() dto: RollbackVersionDto,
  ) {
    return this.kbVersionService.rollback(id, dto.toVersion);
  }

  // ==================== 分步处理 ====================

  @Post(':id/process/chunk')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Chunk a document (parsed → chunked)' })
  async processChunk(@Param('id') id: string) {
    return this.ragService.processStepChunk(id);
  }

  @Post(':id/process/embed')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Embed a document (chunked → embedded), submit to BullMQ',
  })
  async processEmbed(@Param('id') id: string) {
    return this.ragService.processStepEmbed(id);
  }

  @Get(':id/process/status')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: 'Get document processing status' })
  async getProcessStatus(@Param('id') id: string) {
    return this.ragService.getProcessStatus(id);
  }

  // ==================== Bulk operations ====================

  @Post('reindex-all')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Reindex all active documents (bulk re-chunk + re-embed + sync to Meilisearch)',
  })
  async reindexAll() {
    return this.ragService.reindexAll();
  }

  // ==================== Quality stats moved above :id ====================

  // ═══════════════════════════════════════════════════════════════════════════
  // 双源对撞 — Diff + Content Edit
  // ═══════════════════════════════════════════════════════════════════════════

  @Get(':id/diff')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({
    summary: 'Get dual-source diff (pdf-parse vs Unstructured) for a document',
  })
  @ApiParam({ name: 'id', description: 'Document UUID' })
  async getDiff(@Param('id') id: string) {
    return this.ragService.getDiff(id);
  }

  @Patch(':id/content')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({
    summary:
      'Update document content (after manual review), triggers re-chunk + re-embed',
  })
  @ApiParam({ name: 'id', description: 'Document UUID' })
  async updateContent(
    @Param('id') id: string,
    @Body('content') content: string,
  ) {
    if (!content) {
      throw new BadRequestException('content is required');
    }
    return this.ragService.updateContent(id, content);
  }
}
