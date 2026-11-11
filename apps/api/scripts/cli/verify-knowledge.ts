/**
 * 🔍 知识库入库完成校验（#87 N-3 / #88 FR-3）
 * ============================================================
 * 回答一个问题：**源目录里的每篇文档，是否真的入库且可检索？**
 *
 * 之前的导入链路只打印「上传成功」，但上传 ≠ 切分完成 ≠ 向量化完成。
 * 这个脚本做只读校验，任何一项不满足就以退出码 1 报告，可直接接进 CI。
 *
 * 每篇检查：
 *   1. DB 里存在（docId + locale）
 *   2. process_status = indexed
 *   3. chunk 数 > 0
 *   4. 全部 chunk 都有 embedding（没有半成品）
 *   5. domain / content_type / priority / title 与 frontmatter 一致
 *   6. chunk 数与本地切分（与生产同参数 500/50、切正文）一致
 *
 * 用法:
 *   yarn workspace @lucky/api verify-knowledge
 * ============================================================
 */
import { PrismaClient } from '@prisma/client';
import { MarkdownTextSplitter } from '@langchain/textsplitters';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { loadEnvForHost } from '../utils/load-env-for-host';

loadEnvForHost(); // ← 必须在 new PrismaClient() 前执行

const db = new PrismaClient();

/** 源目录（scripts 由 yarn workspace 在 apps/api 下执行） */
const KNOWLEDGE_DIR = join(process.cwd(), 'src/client/ai-customer/knowledge');

/** 必须与 rag-chunk.service.ts 的 DEFAULT_CHUNK_SIZE / OVERLAP 保持一致 */
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

interface SourceDoc {
  file: string;
  docId: string;
  locale: string;
  title: string;
  domain: string;
  contentType: string;
  priority: string;
  expectedChunks: number | null;
}

interface Problem {
  file: string;
  reason: string;
}

// ── 源文件解析 ──────────────────────────────────────────────────

/** 递归收集 .md / .pdf，跳过 _ 开头的目录（如 _archived） */
async function collectFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;

    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(full)));
    } else if (entry.name.endsWith('.md') || entry.name.endsWith('.pdf')) {
      out.push(full);
    }
  }
  return out.sort();
}

/** 与 MarkdownExtractor 相同的简易 frontmatter 解析 */
function parseFrontmatter(md: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: md };

  const frontmatter: Record<string, unknown> = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (!kv) continue;
    const [, key, rawValue] = kv;
    const value = rawValue.trim();

    if (value.startsWith('[') && value.endsWith(']')) {
      frontmatter[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
    } else {
      frontmatter[key] = value.replace(/^['"]|['"]$/g, '');
    }
  }
  return { frontmatter, body: match[2].trim() };
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : fallback;
}

async function readSource(file: string): Promise<SourceDoc> {
  const text = await readFile(file, 'utf-8');
  const isPdf = file.toLowerCase().endsWith('.pdf');
  const { frontmatter, body } = isPdf
    ? { frontmatter: {} as Record<string, unknown>, body: '' }
    : parseFrontmatter(text);

  let expected: number | null = null;
  if (!isPdf) {
    const splitter = new MarkdownTextSplitter({
      chunkSize: CHUNK_SIZE,
      chunkOverlap: CHUNK_OVERLAP,
    });
    expected = (await splitter.splitText(body)).length;
  }

  return {
    file: relative(KNOWLEDGE_DIR, file),
    docId: str(frontmatter.docId, basename(file).replace(/\.[^.]+$/, '')),
    locale: str(frontmatter.locale, 'en'),
    title: str(frontmatter.title, basename(file).replace(/\.[^.]+$/, '')),
    domain: str(frontmatter.domain, 'general'),
    contentType: str(frontmatter.contentType, 'policy'),
    priority: str(frontmatter.priority, 'P2'),
    expectedChunks: expected,
  };
}

// ── 主流程 ──────────────────────────────────────────────────────

async function main() {
  console.log('\n🔍 知识库入库校验');
  console.log('=========================================');

  const files = await collectFiles(KNOWLEDGE_DIR);
  if (files.length === 0) {
    console.error(`❌ 没找到任何源文件：${KNOWLEDGE_DIR}`);
    process.exit(1);
  }
  console.log(`  源目录 : ${KNOWLEDGE_DIR}`);
  console.log(`  文档数 : ${files.length}\n`);

  // 一次查询拿全部 chunk 统计，避免 N+1
  const chunkStats = await db.$queryRaw<
    { document_id: string; total: number; embedded: number }[]
  >`
    SELECT document_id,
           COUNT(*)::int          AS total,
           COUNT(embedding)::int  AS embedded
    FROM document_chunks
    GROUP BY document_id
  `;
  const statsById = new Map(chunkStats.map((row) => [row.document_id, row]));

  const problems: Problem[] = [];
  const seenDocIds = new Set<string>();
  let passed = 0;

  for (const file of files) {
    const source = await readSource(file);
    seenDocIds.add(source.docId);

    const doc = await db.knowledgeDocument.findUnique({
      where: {
        docId_locale: { docId: source.docId, locale: source.locale },
      },
    });

    if (!doc) {
      problems.push({ file: source.file, reason: 'missing（DB 中不存在）' });
      continue;
    }

    const failures: string[] = [];
    const stats = statsById.get(doc.id) ?? {
      document_id: doc.id,
      total: 0,
      embedded: 0,
    };

    if (doc.processStatus !== 'indexed') {
      failures.push(`status=${doc.processStatus}`);
    }
    if (stats.total === 0) {
      failures.push('chunks=0');
    }
    if (stats.embedded !== stats.total) {
      failures.push(`embedded=${stats.embedded}/${stats.total}`);
    }
    if (doc.domain !== source.domain) {
      failures.push(`domain: db=${doc.domain} file=${source.domain}`);
    }
    if (doc.contentType !== source.contentType) {
      failures.push(
        `contentType: db=${doc.contentType} file=${source.contentType}`,
      );
    }
    if (doc.priority !== source.priority) {
      failures.push(`priority: db=${doc.priority} file=${source.priority}`);
    }
    if (doc.title !== source.title) {
      failures.push(`title: db="${doc.title}" file="${source.title}"`);
    }
    if (source.expectedChunks !== null && stats.total !== source.expectedChunks) {
      failures.push(`chunks: db=${stats.total} expected=${source.expectedChunks}`);
    }

    if (failures.length > 0) {
      problems.push({ file: source.file, reason: failures.join('; ') });
    } else {
      passed++;
      console.log(
        `  ✅ ${source.docId.padEnd(24)} indexed  ${stats.total}/${stats.total} chunk  [${source.domain}/${source.contentType}/${source.priority}]`,
      );
    }
  }

  // 库里多出来的（源目录已删除 / 重命名）
  const orphans = await db.knowledgeDocument.findMany({
    select: { docId: true, locale: true },
  });
  for (const orphan of orphans) {
    if (!seenDocIds.has(orphan.docId)) {
      console.log(
        `  ⚠️  ${orphan.docId} 存在于 DB，但源目录没有对应文件（不判失败）`,
      );
    }
  }

  console.log('\n=========================================');
  if (problems.length === 0) {
    console.log(`  ✅ PASS  ${passed}/${files.length} 篇全部入库且可检索\n`);
    return;
  }

  console.log(`  ❌ FAIL  ${passed}/${files.length} 通过，${problems.length} 篇有问题：\n`);
  for (const problem of problems) {
    console.log(`     ${problem.file}\n       ${problem.reason}`);
  }
  console.log('');
  process.exitCode = 1;
}

main()
  .catch((err: Error) => {
    console.error('\n❌ 校验失败:', err.message, '\n');
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
