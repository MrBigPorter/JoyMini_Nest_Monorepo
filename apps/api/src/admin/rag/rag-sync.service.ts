import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import axios from 'axios';
import { RagChunkService } from './rag-chunk.service';
import { RagEmbeddingService } from './rag-embedding.service';
import { RagQualityService } from './rag-quality.service';
import { UploadService } from '@api/common/upload/upload.service';
import { AiService } from '@api/common/ai/ai.service';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { RAG_EMBEDDING_QUEUE } from './rag-embedding-queue.constants';

// =============================================================================
// 策略接口 — TextExtractor
// =============================================================================
// 为什么用 Strategy 模式而不是 if-else？
//   1. 开闭原则：新增文件格式（.txt, .docx, 图片OCR）只需要新建一个 XxxExtractor 类，
//      注册到 RagSyncService.extractors 数组即可，uploadFile() 一行都不需要改。
//   2. 每个提取器独立测试：MarkdownExtractor 和 PdfExtractor 可以单独写单元测试。
//   3. 职责清晰：canHandle() 负责"识别"，extract() 负责"解析"，互不干扰。
//
// 为什么不需要 OCR？
//   系统中目前只有 .md 和 .pdf 两种格式。
//   - .md 文件本质是 UTF-8 纯文本，直接 buffer.toString('utf-8') 即可，无需图像识别。
//   - .pdf 使用 pdf-parse 库（只提取 PDF 文本流，不做 OCR），所以也只处理文字型 PDF。
//   如果未来需要支持扫描件/图片，新建一个 ImageExtractor 集成 Tesseract.js 即可。
// =============================================================================

/**
 * 提取结果的数据结构。
 * content 和 metadata 都是纯文本/纯数据，不涉及二进制图像。
 */
interface ExtractedDoc {
  title: string;
  content: string;
  /** pdf-parse 原始文本输出（仅 PDF 提取器需要），用于双源对撞基准 */
  rawContent?: string;
  metadata: Record<string, any>;
}

/**
 * 文件提取器策略接口。
 * - canHandle(): 基于文件名判断是否能处理（不检查 mimetype，因为浏览器/curl 可能发错 Content-Type）
 * - extract(): 从 file.buffer 中提取纯文本和结构化元数据
 */
interface TextExtractor {
  canHandle(filename: string): boolean;
  extract(file: Express.Multer.File): Promise<ExtractedDoc>;
}

// =============================================================================
// Markdown 提取器
// =============================================================================
// 为什么这个提取器不需要 OCR？
//   Markdown 文件本质是 UTF-8 编码的纯文本文件。file.buffer.toString('utf-8')
//   直接把二进制内容转换成字符串，不涉及任何图像处理。
//
// 解析 YAML Frontmatter:
//   JoyMini 的知识文档使用 YAML frontmatter（--- 分隔的头部）来存储结构化元数据，
//   包括：title, domain, docId, keywords, locale, contentType, priority。
//   这些字段在后续 RAG 检索中用于按 domain 过滤、按 locale 多语言匹配、按 priority 排序。
//
// 手写 YAML 解析 vs js-yaml 包:
//   这里的 frontmatter 格式非常有限（仅支持 key: value 单行），
//   所以用手写正则就够了，不需要引入 js-yaml 依赖。这是一个"够用就行"的设计决策。
//   如果未来 frontmatter 变得复杂（嵌套对象、多行值），应该换成 js-yaml。
// =============================================================================
class MarkdownExtractor implements TextExtractor {
  canHandle(filename: string): boolean {
    return filename.endsWith('.md');
  }

  async extract(file: Express.Multer.File): Promise<ExtractedDoc> {
    // === 核心：纯文本读取，不需要 OCR ===
    // file.buffer 是 multer 已经把整个文件加载到内存中的二进制数据。
    // 对 .md 文件来说，这些二进制数据就是 UTF-8 编码的文本字符。
    // toString('utf-8') 直接把内存中的字节序列解码成 JavaScript 字符串。
    // 整个过程就是"字节 → 字符"的编码转换，不涉及图像识别。
    const content = file.buffer.toString('utf-8');
    const parsed = this.parseFrontmatter(content);

    if (!parsed) {
      throw new BadRequestException(
        'Invalid .md: missing YAML frontmatter (--- ... ---)',
      );
    }

    return {
      title: parsed.frontmatter.title || file.originalname.replace(/\.md$/, ''),
      content: parsed.markdown,
      metadata: parsed.frontmatter,
    };
  }

  /**
   * 手写简易 YAML frontmatter 解析器。
   *
   * 正则 /^---\n([\s\S]*?)\n---\n([\s\S]*)$/ 解释：
   * - ^---\n       → 文件必须以 "---\n" 开头
   * - ([\s\S]*?)   → 非贪婪匹配 YAML block（包括换行符）
   * - \n---\n      → YAML block 以 "\n---\n" 结束
   * - ([\s\S]*)    → 剩余部分都是 markdown 正文
   *
   * 之所以用 [\s\S] 而不是 .，是因为 JavaScript 的 . 不匹配换行符，
   * 而 YAML block 和 markdown 正文都包含换行符。
   */
  private parseFrontmatter(
    md: string,
  ): { frontmatter: Record<string, any>; markdown: string } | null {
    const match = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return null;

    const yamlBlock = match[1];
    const markdown = match[2].trim();
    const frontmatter: Record<string, any> = {};

    // 逐行解析 YAML key: value
    // 支持的值类型：
    //   - 数组:  [a, b, c]  → 按逗号分割并 trim
    //   - 布尔:  true/false → 转为 boolean
    //   - 数字:  123        → 转为 number
    //   - 字符串: 其他        → 去除引号后保留
    // 注意：不支持多行值、嵌套对象、引号转义等复杂 YAML 语法。
    //       我们的 frontmatter 只有 7-8 个简单字段，所以够用了。
    for (const line of yamlBlock.split('\n')) {
      const kvMatch = line.match(/^(\w+):\s*(.+)$/);
      if (!kvMatch) continue;
      const [, key, value] = kvMatch;
      const trimmed = value.trim();

      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        // 数组值：如 keywords: [refund, return, 退货]
        frontmatter[key] = trimmed
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
      } else if (trimmed === 'true' || trimmed === 'false') {
        // 布尔值
        frontmatter[key] = trimmed === 'true';
      } else if (/^\d+$/.test(trimmed)) {
        // 纯数字
        frontmatter[key] = parseInt(trimmed, 10);
      } else {
        // 字符串值：去除可能的引号包裹
        frontmatter[key] = trimmed.replace(/^['"]|['"]$/g, '');
      }
    }

    return { frontmatter, markdown };
  }
}

// =============================================================================
// PDF 提取器（Unstructured 主引擎，pdf-parse 降级）
// =============================================================================
// 采用串行策略：
//   1. 优先尝试 Unstructured API（支持 OCR、表格、多栏排版）
//   2. 如果 Unstructured 不可用，降级到 pdf-parse（仅文字型 PDF）
//
// 双引擎并行 + LLM Diff 审计（P1）代码已保留在 rag-quality.service.ts 中，
// 后续需要时可以启用。
// =============================================================================

/** Unstructured API 基础 URL（Docker 内部网络） */
const UNSTRUCTURED_URL =
  process.env.UNSTRUCTURED_URL || 'http://joymini-unstructured:8000';

class PdfExtractor implements TextExtractor {
  canHandle(filename: string): boolean {
    return filename.endsWith('.pdf');
  }

  async extract(file: Express.Multer.File): Promise<ExtractedDoc> {
    const title = file.originalname.replace(/\.pdf$/i, '');
    const logger = new Logger('PdfExtractor');

    // ── 1. 先用 pdf-parse 提取原始文本（诚实基准线）──
    // pdf-parse 是"照妖镜"：输出物理真实，绝不漏字/瞎编。
    // 用作双源对撞的 rawContent 基准。
    let rawContent: string | null = null;
    try {
      rawContent = await this.extractWithPdfParse(file);
    } catch (err) {
      logger.warn(`pdf-parse failed: ${err instanceof Error ? err.message : 'Unknown'}`);
    }

    // ── 2. 优先尝试 Unstructured API（AI 解析线）──
    try {
      const content = await this.extractWithUnstructured(file);
      if (content && content.trim().length > 0) {
        // 🔍 DEBUG: 对比 pdf-parse 和 Unstructured（纯内容，去格式）
        if (rawContent) {
          const pdfPlain = rawContent.replace(/\s+/g, '').slice(0, 200);
          const usPlain = content.replace(/\s+/g, '').slice(0, 200);
          const match = pdfPlain === usPlain;
          logger.debug(`[COMPARE] ${file.originalname}`);
          logger.debug(`[COMPARE] pdf-parse(${rawContent.length}chars) vs Unstructured(${content.length}chars)`);
          logger.debug(`[COMPARE] Content match (no format): ${match ? '✅' : '❌'}`);
          if (!match) {
            logger.debug(`[COMPARE] pdf-parse raw[0:200]: ${rawContent.slice(0, 200)}`);
            logger.debug(`[COMPARE] Unstructured raw[0:200]: ${content.slice(0, 200)}`);
          }
        }

        return {
          title,
          content,
          rawContent: rawContent ?? undefined,
          metadata: { needsMetadata: true },
        };
      }
    } catch {
      // Unstructured 不可用，降级到 pdf-parse
    }

    // ── 降级: pdf-parse 同时作为 content 和 rawContent ──
    const content = rawContent ?? await this.extractWithPdfParse(file);

    return {
      title,
      content,
      rawContent: content,
      metadata: { needsMetadata: true },
    };
  }

  /**
   * 通过 Unstructured API 解析 PDF（支持 OCR、表格、多栏）
   * 需要先启动容器: make start-unstructured
   */
  private async extractWithUnstructured(
    file: Express.Multer.File,
  ): Promise<string> {
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('files', file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype || 'application/pdf',
    });

    const response = await axios.post(
      `${UNSTRUCTURED_URL}/general/v0/general`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          accept: 'application/json',
        },
        timeout: 120_000, // 大文件可能需 2 分钟
      },
    );

    const elements = response.data as Array<{
      type: string;
      text?: string;
      metadata?: { page_number?: number };
    }>;

    if (!Array.isArray(elements) || elements.length === 0) {
      return '';
    }

    // 将解析结果拼接为 Markdown
    return elements
      .map((el) => {
        if (el.type === 'Title') return `# ${el.text}`;
        if (el.type === 'Header') return `## ${el.text}`;
        if (el.type === 'SubHeader') return `### ${el.text}`;
        if (el.type === 'Table') return el.text || '';
        if (el.type === 'ListItem') return `- ${el.text}`;
        if (el.type === 'Image') return ''; // 跳过图片
        return el.text || '';
      })
      .filter(Boolean)
      .join('\n\n');
  }

  /**
   * 通过 pdf-parse 提取文本（降级方案，仅文字型 PDF 有效）
   */
  private async extractWithPdfParse(
    file: Express.Multer.File,
  ): Promise<string> {
    // pdf-parse v2.x: exports { PDFParse } class
    // Constructor takes LoadParameters: { data: Uint8Array }
    // Method: getText() → TextResult { text: string }
    let pdfParseModule: any;
    try {
      pdfParseModule = require('pdf-parse');
    } catch {
      throw new BadRequestException(
        'pdf-parse not installed. Run: yarn add pdf-parse',
      );
    }
    const PDFParse = pdfParseModule.PDFParse;
    if (!PDFParse) {
      throw new BadRequestException(
        'pdf-parse API mismatch: PDFParse not found in module',
      );
    }
    const parser = new PDFParse({ data: new Uint8Array(file.buffer) });
    const result = await parser.getText();
    return result.text || '';
  }
}

// =============================================================================
// RagSyncService — 文件上传同步服务
// =============================================================================
@Injectable()
export class RagSyncService {
  private readonly logger = new Logger(RagSyncService.name);
  private readonly extractors: TextExtractor[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly ragChunkService: RagChunkService,
    private readonly ragEmbeddingService: RagEmbeddingService,
    private readonly ragQualityService: RagQualityService,
    private readonly uploadService: UploadService,
    @InjectQueue(RAG_EMBEDDING_QUEUE)
    private readonly ragEmbeddingQueue: Queue,
  ) {
    // 注册提取器。新增格式只需在这里 push。
    this.extractors = [
      new MarkdownExtractor(),
      new PdfExtractor(),
    ];
  }

  /**
   * Upload a file (.md or .pdf) and upsert to DB.
   *
   * 完整流程（7步）：
   *   1. 用 Strategy 模式找到匹配的文件提取器
   *   2. 提取纯文本 content + 结构化 metadata
   *   3. 合并元数据（优先级：frontmatter > user overrides > 默认值）
   *   4. 基于 docId_locale 唯一键 upsert 到 knowledge_documents 表
   *   5. 删除旧的 document_chunks，用 RecursiveCharacterTextSplitter 重新切片
   *   6. 调用 AiService.generateEmbedding() 向量化所有新 chunks
   *   7. 返回 { document, action, needsMetadata } 给前端
   *
   * 为什么整个流程都是纯文本处理？
   *   从步骤 1 到步骤 6，所有数据都是字符串（文本 content）或结构化数据（metadata）。
   *   没有像素、没有图像、没有 OCR 需求。
   *   这是因为 JoyMini 的知识库专门存放数字生成的文档（.md 和文字型 .pdf），
   *   不处理扫描件/图片。
   *
   * @param file      从 multer 接收的内存文件（含 buffer）
   * @param overrides 用户在前端填写的 metadata 覆盖字段（PDF 必需，因为 PDF 没有 frontmatter）
   */
  async uploadFile(
    file: Express.Multer.File,
    overrides?: {
      domain?: string;
      locale?: string;
      keywords?: string;
      contentType?: string;
      priority?: string;
    },
  ): Promise<{
    document: any;
    action: 'created' | 'updated';
    needsMetadata: boolean;
  }> {
    // ==================== 第 1 步：选择提取器 ====================
    // 基于文件名的后缀来判断。为什么不检查 mimetype？
    //   - 浏览器上传时 mimetype 可能是 application/octet-stream
    //   - curl 请求可能不设置 Content-Type
    //   文件名后缀是最可靠的判断依据。
    //   缺点是重命名风险（report.pdf 实际上是图片），但这是内部管理后台，上传者可信任。
    const extractor = this.extractors.find((e) =>
      e.canHandle(file.originalname),
    );
    if (!extractor) {
      throw new BadRequestException(
        `Unsupported file type: ${file.originalname}. Supported: .md, .pdf`,
      );
    }

    // ==================== 第 2 步：提取文本和元数据 ====================
    // 调用对应提取器的 extract() 方法。
    // 对于 .md：直接 buffer.toString('utf-8') + 正则解析 frontmatter（纯文本操作）
    // 对于 .pdf：pdf-parse 提取文本流（非 OCR，只是读取 PDF 容器中的文字编码）
    const doc = await extractor.extract(file);

    // ==================== 第 2b 步：双源提取 + 原始文件存储 ====================
    // 双源对撞架构（详见 docs/AI-joymini/62-Enterprise-Parse-Quality-Dual-Source-Architecture.md）：
    //   - PdfExtractor 已同时提取 pdf-parse（rawContent）和 Unstructured（content）
    //   - 原始文件上传到 R2 → fileUrl（PDF 预览用）
    //
    // 为什么 rawContent 改存 pdf-parse 而不是 R2 URL？
    //   pdf-parse 是"照妖镜"——它的输出物理真实、绝不瞎编。
    //   双源对撞时拿它做基准去撞 Unstructured 的输出，差异就是 AI 可能犯错的地方。
    //   R2 URL 单独存为 fileUrl 字段，用于前端 PDF 预览。
    let rawContent: string | null = doc.rawContent ?? null;
    let fileUrl: string | null = null;
    const isPdf = file.originalname.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      // ── 原始文件上传到 R2 → fileUrl（PDF 预览用）──
      try {
        const uploadResult = await this.uploadService.uploadFile(file, 'knowledge');
        fileUrl = uploadResult.url;
        this.logger.log(`[R2] Uploaded original file: ${uploadResult.url}`);
      } catch (r2Error) {
        const msg = r2Error instanceof Error ? r2Error.message : 'Unknown error';
        this.logger.warn(`[R2] Upload failed for ${file.originalname}: ${msg}`);
      }
    } else {
      // .md 文件：直接存 buffer 文本（MarkdownExtractor 不返回 rawContent）
      rawContent = file.buffer.toString('utf-8');
    }

    // ==================== 第 2c 步：启发式质量检查 ====================
    // 对提取的文本执行 4 项检查（空内容/截断/编码/字符保留率）。
    // 检查失败不会阻塞上传，只是记录问题到 qualityScore/qualityFlags。
    // 管理员可以在 Admin 面板看到质量评分和问题标记。
    const qualityResult = this.ragQualityService.check(
      doc.content,
      file.buffer.length,
    );
    if (!qualityResult.passed) {
      this.logger.warn(
        `[Quality] ${file.originalname}: ` +
        `score=${qualityResult.overallScore}, ` +
        `flags=[${qualityResult.flags.join(', ')}]`,
      );
    }

    // ==================== 第 3 步：合并元数据 ====================
    // 优先级：frontmatter 中的值 > 前端用户填写 > 代码默认值
    // 例如：.md 文件的 frontmatter 中写了 domain: order，
    //       但用户在弹窗里填了 domain: product，则用户填的覆盖（overrides.domain）。
    const docId =
      doc.metadata.docId || file.originalname.replace(/\.[^.]+$/, '');
    const locale = overrides?.locale || doc.metadata.locale || 'en';

    // 检查是否已存在相同 docId + locale 的文档
    const existing = await this.prisma.knowledgeDocument.findUnique({
      where: { docId_locale: { docId, locale } },
    });


    const data = {
      title: overrides?.domain
        ? `${doc.title} (${overrides.domain})`
        : doc.title,
      domain: overrides?.domain || doc.metadata.domain || 'general',
      qualityScore: qualityResult.overallScore,
      qualityFlags: qualityResult.flags.length > 0 ? qualityResult.flags.join(',') : null,
      keywords: overrides?.keywords
        ? overrides.keywords.split(',').map((s) => s.trim())
        : Array.isArray(doc.metadata.keywords)
          ? doc.metadata.keywords
          : [],
      contentType:
        overrides?.contentType || doc.metadata.contentType || 'policy',
      priority: overrides?.priority || doc.metadata.priority || 'P2',
      content: doc.content,
      rawContent: rawContent,
      fileUrl: fileUrl,
      isActive: true,
    };

    // ==================== 第 4 步：入库（create or update） ====================
    // 使用 docId_locale 联合唯一键做 upsert。
    // 相同 docId + locale 上传两次 → update（version +1）
    // 相同 docId + 不同 locale → create（多语言共存）
    let document: any;
    let action: 'created' | 'updated';

    if (existing) {
      document = await this.prisma.knowledgeDocument.update({
        where: { docId_locale: { docId, locale } },
        data: { ...data, version: existing.version + 1 },
      });
      action = 'updated';
    } else {
      document = await this.prisma.knowledgeDocument.create({
        data: { docId, locale, ...data },
      });
      action = 'created';
    }

    // ==================== 第 5 步：切片 ====================
    // 先删除旧 chunks（CASCADE 会自动清理 document_chunks 中外键关联的记录）
    // 然后使用 LangChain 的 RecursiveCharacterTextSplitter 按 Markdown 结构切分
    // 切分依据优先级：## 标题 → ### 子标题 → 段落 → 行 → 中文句号 → 字符
    await this.prisma.documentChunk.deleteMany({
      where: { documentId: document.id },
    });

    const chunks = await this.ragChunkService.chunkText(document.content);

    if (chunks.length > 0) {
      await this.prisma.documentChunk.createMany({
        data: chunks.map((chunk) => ({
          documentId: document.id,
          chunkIndex: chunk.index,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
          documentVersion: document.version,
        })),
      });
      this.logger.log(
        `Created ${chunks.length} chunks for document ${document.id} (v${document.version})`,
      );
    }

    // ==================== 第 6 步：提交向量化任务到队列 ====================
    // 改为异步：不再同步等待所有 chunk 向量化完成。
    // 而是提交一个 BullMQ job 到 rag-embedding 队列，立即返回。
    //
    // 为什么改异步？
    //   大文档（如 10 万字）会产生 ~200 个 chunk，
    //   每个 chunk 调用 Ollama bge-m3 约 200-500ms，
    //   同步等待需要 60 秒，远超 API 网关 30 秒超时。
    //
    // 错误隔离：如果队列不可用，记录日志但不抛异常。
    // 未向量化的 chunks 可以通过前端的"reindex"按钮手动重试。
    try {
      await this.ragEmbeddingQueue.add('embed', {
        documentId: document.id,
      });
      this.logger.log(
        `Submitted embedding job for document ${document.id} (${chunks.length} chunks)`,
      );
    } catch (error) {
      // 队列不可用时（如 Redis 宕机），不阻塞上传流程
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to submit embedding job for document ${document.id}: ${message}`,
      );
    }

    // ==================== 第 7 步：返回结果 ====================
    return {
      document,
      action,
      // needsMetadata 告诉前端是否需要弹窗让用户补充元数据
      // - .md 文件：false（有 frontmatter，不需要）
      // - .pdf 文件：true（没有 frontmatter，需要用户填写）
      needsMetadata: !!doc.metadata.needsMetadata,
    };
  }
}
