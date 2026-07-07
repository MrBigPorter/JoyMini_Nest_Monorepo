import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { RagChunkService } from './rag-chunk.service';
import { RagEmbeddingService } from './rag-embedding.service';
import { PrismaService } from '@api/common/prisma/prisma.service';

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
// PDF 提取器
// =============================================================================
// 为什么这个提取器也不做 OCR？
//   pdf-parse 是一个纯 JavaScript 的 PDF 解析器，它读取 PDF 文件中的文本流对象
//   （Text Stream），提取出编码在 PDF 中的文字。它不执行光学字符识别（OCR）。
//
// 这意味着：
//   ✅ 文字型 PDF（从 Word/Google Docs 导出，或直接保存的文本 PDF）→ 正常提取
//   ❌ 扫描型 PDF（纸质文件扫描成图片再转 PDF）→ data.text 为空字符串
//
// 对于 JoyMini 的用例，知识文档都是数字生成的（政策文档、操作指南），
// 不是纸质的扫描件，所以 pdf-parse 提取文本就足够了。
// 如果未来需要处理扫描件，这里需要集成 OCR 引擎（如 Tesseract.js）。
//
// needsMetadata 标志：
//   PDF 没有 YAML frontmatter，所以提取出来的 metadata 很有限（只有 author 和 pages）。
//   前端通过 needsMetadata=true 知道需要弹窗让用户手动填写 domain、locale、keywords 等字段。
// =============================================================================
class PdfExtractor implements TextExtractor {
  canHandle(filename: string): boolean {
    return filename.endsWith('.pdf');
  }

  async extract(file: Express.Multer.File): Promise<ExtractedDoc> {
    // 动态 import pdf-parse
    // 为什么动态 import？因为 pdf-parse 是一个较大的依赖（~2MB），
    // 而且项目中可能不常用 PDF 上传。动态 import 确保：
    // 1. 不使用时不会加载到内存
    // 2. 环境未安装时优雅报错，而不是启动时就 crash
    let pdfParse: any;
    try {
      pdfParse = (await import('pdf-parse')).default;
    } catch {
      throw new BadRequestException(
        'pdf-parse not installed. Run: yarn add pdf-parse',
      );
    }

    // pdfParse(file.buffer) 解析 PDF 文件结构：
    // 1. 读取 PDF header → 版本号
    // 2. 解析交叉引用表（xref table）→ 找到所有对象
    // 3. 遍历页面对象（Page Objects）→ 提取文本流（Text Stream）
    // 4. 拼接所有文本流 → 返回 data.text
    // 整个过程不涉及 OCR，只读取 PDF 文件中已编码的文字数据。
    const data = await pdfParse(file.buffer);
    const title = file.originalname.replace(/\.pdf$/i, '');

    return {
      title,
      content: data.text,
      metadata: {
        author: data.metadata?.author || null,
        pages: data.numpages,
        // 关键标志：告诉前端用户需要手动补充 metadata
        needsMetadata: true,
      },
    };
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
  ) {
    // 注册提取器。新增格式只需在这里 push。
    this.extractors = [new MarkdownExtractor(), new PdfExtractor()];
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
      keywords: overrides?.keywords
        ? overrides.keywords.split(',').map((s) => s.trim())
        : Array.isArray(doc.metadata.keywords)
          ? doc.metadata.keywords
          : [],
      contentType:
        overrides?.contentType || doc.metadata.contentType || 'policy',
      priority: overrides?.priority || doc.metadata.priority || 'P2',
      content: doc.content,
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

    // ==================== 第 6 步：向量化 ====================
    // 调用 AiService.generateEmbedding() → Ollama bge-m3 → 1024 维向量
    // 存入 pgvector 的 embedding 列（使用 raw SQL 因为 Prisma 不支持 Unsupported 类型）
    //
    // 错误隔离：如果 Ollama 服务暂时不可用，embedDocument 会记录日志但不抛异常。
    // 这样上传流程不会因为向量化失败而整体回滚。
    // 未向量化的 chunks 可以通过前端的"reindex"按钮手动重试。
    await this.ragEmbeddingService.embedDocument(document.id);

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
