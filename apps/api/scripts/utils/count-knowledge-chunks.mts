/**
 * 统计知识库 chunk 数（纯本地切分，不调用任何 API）
 *
 * 与生产链路使用同一套参数：
 *   MarkdownTextSplitter + chunkSize 500 + chunkOverlap 50
 *   （来源：src/admin/rag/rag-chunk.service.ts:46-47）
 *
 * 用法：
 *   cd apps/api && npx tsx scripts/utils/count-knowledge-chunks.mts
 */
import { MarkdownTextSplitter } from '@langchain/textsplitters';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const KNOWLEDGE_DIR = join(process.cwd(), 'src/client/ai-customer/knowledge');
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

/** 递归收集 .md 文件，跳过以 _ 开头的目录（如 _archived） */
async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('_')) continue;
      files.push(...(await collectMarkdownFiles(full)));
    } else if (entry.name.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

async function main() {
  const splitter = new MarkdownTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  });

  const files = await collectMarkdownFiles(KNOWLEDGE_DIR);

  type Bucket = { docs: number; chars: number; chunks: number };
  const byDomain: Record<string, Bucket> = {};
  let totalChunks = 0;
  let totalChars = 0;

  for (const file of files) {
    const content = await readFile(file, 'utf-8');
    const domain = relative(KNOWLEDGE_DIR, file).split('/')[0];
    const chunks = await splitter.splitText(content);

    const bucket = (byDomain[domain] ??= { docs: 0, chars: 0, chunks: 0 });
    bucket.docs += 1;
    bucket.chars += content.length;
    bucket.chunks += chunks.length;
    totalChunks += chunks.length;
    totalChars += content.length;
  }

  console.log('\n按业务域统计\n');
  console.log('域'.padEnd(14), '文档'.padStart(6), '字符'.padStart(10), 'chunk'.padStart(8));
  console.log('-'.repeat(42));
  for (const [domain, b] of Object.entries(byDomain).sort((a, z) => z[1].chunks - a[1].chunks)) {
    console.log(
      domain.padEnd(14),
      String(b.docs).padStart(6),
      String(b.chars).padStart(10),
      String(b.chunks).padStart(8),
    );
  }
  console.log('-'.repeat(42));
  console.log(
    '合计'.padEnd(14),
    String(files.length).padStart(6),
    String(totalChars).padStart(10),
    String(totalChunks).padStart(8),
  );

  const avg = totalChunks > 0 ? Math.round(totalChars / files.length) : 0;
  console.log(`\n平均每篇 ${avg} 字符，平均每篇 ${files.length ? (totalChunks / files.length).toFixed(1) : 0} 个 chunk`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
