/**
 * 一键同步 AI 数据：知识库 + Prompt + 意图例句
 *
 * 从本地（或任意源）读数据，写到目标环境（默认生产）。
 * 只调 admin API，不直连数据库；token 由外层 shell 注入，不落盘。
 *
 * 用法：
 *   yarn workspace @lucky/api sync-ai-data -- --dry-run
 *   LOCAL_API=... TARGET_API=... LOCAL_TOKEN=... TARGET_TOKEN=... \
 *     yarn workspace @lucky/api sync-ai-data
 *
 * 可用 SKIP_KNOWLEDGE=1 / SKIP_PROMPTS=1 / SKIP_INTENT=1 分项跳过。
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const LOCAL_API = (process.env.LOCAL_API || 'http://localhost/api').replace(/\/$/, '');
const TARGET_API = (process.env.TARGET_API || LOCAL_API).replace(/\/$/, '');
const LOCAL_TOKEN = process.env.LOCAL_TOKEN || '';
const TARGET_TOKEN = process.env.TARGET_TOKEN || '';
const DRY_RUN = process.argv.includes('--dry-run');
const DELAY = Number(process.env.SYNC_DELAY_MS || 200);
const KNOWLEDGE_DIR = process.env.KNOWLEDGE_DIR ||
  resolve(process.cwd(), 'src/client/ai-customer/knowledge');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function unwrap(payload: any): any {
  if (payload && typeof payload === 'object' && 'code' in payload) {
    if (payload.code !== 10000) {
      throw new Error(`API error ${payload.code}: ${payload.message ?? ''}`);
    }
    return payload.data;
  }
  return payload;
}

async function api(base: string, token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return text ? unwrap(JSON.parse(text)) : null;
}

function collectKnowledgeFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectKnowledgeFiles(full));
    else if (entry.name.endsWith('.md') || entry.name.endsWith('.pdf')) out.push(full);
  }
  return out.sort();
}

async function syncKnowledge(): Promise<string> {
  const files = collectKnowledgeFiles(KNOWLEDGE_DIR);
  if (files.length === 0) return 'knowledge: 没有文件';
  if (DRY_RUN) return `knowledge: ${files.length} 个文件（dry-run）`;
  let created = 0;
  let updated = 0;
  const failed: string[] = [];
  for (const file of files) {
    const name = file.split('/').pop()!;
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(readFileSync(file))], { type: 'text/markdown' }), name);
    try {
      const result = await api(TARGET_API, TARGET_TOKEN, '/v1/admin/rag/documents/upload', {
        method: 'POST',
        body: form,
      });
      if (result?.action === 'updated') updated++;
      else created++;
      console.log(`  ✅ knowledge ${name} → ${result?.action ?? 'created'}`);
    } catch (e: any) {
      failed.push(`${name}: ${e.message}`);
      console.log(`  ❌ knowledge ${name} → ${e.message}`);
    }
    await sleep(DELAY);
  }
  return `knowledge: 新建 ${created}，更新 ${updated}，失败 ${failed.length}`;
}

async function syncPrompts(): Promise<string> {
  const local = await api(LOCAL_API, LOCAL_TOKEN, '/v1/admin/ai-prompt?pageSize=100');
  const target = DRY_RUN
    ? { items: [] }
    : await api(TARGET_API, TARGET_TOKEN, '/v1/admin/ai-prompt?pageSize=100');
  const targetByName = new Map<string, any>((target?.items ?? []).map((p: any) => [p.name, p]));
  let created = 0;
  let versioned = 0;
  let skipped = 0;

  for (const prompt of local?.items ?? []) {
    const config = prompt.versions?.[0]?.config;
    if (!config) { skipped++; continue; }
    const existing = targetByName.get(prompt.name);

    if (DRY_RUN) {
      console.log(`  ${existing ? '↻' : '+'} prompt ${prompt.name}`);
      continue;
    }

    if (!existing) {
      await api(TARGET_API, TARGET_TOKEN, '/v1/admin/ai-prompt', {
        method: 'POST',
        body: JSON.stringify({
          name: prompt.name,
          displayName: prompt.displayName,
          description: prompt.description ?? undefined,
          category: prompt.category,
          domain: prompt.domain ?? undefined,
          config,
        }),
      });
      created++;
      console.log(`  ✅ prompt ${prompt.name} → created`);
      await sleep(DELAY);
      continue;
    }

    const active = existing.versions?.[0]?.config;
    if (isDeepStrictEqual(active, config)) {
      skipped++;
      continue;
    }

    const version = await api(
      TARGET_API,
      TARGET_TOKEN,
      `/v1/admin/ai-prompt/${existing.id}/versions`,
      { method: 'POST', body: JSON.stringify({ config, changeLog: 'synced from local' }) },
    );
    await api(
      TARGET_API,
      TARGET_TOKEN,
      `/v1/admin/ai-prompt/${existing.id}/activate/${version.version}`,
      { method: 'PUT' },
    );
    versioned++;
    console.log(`  ✅ prompt ${prompt.name} → version ${version.version}`);
    await sleep(DELAY);
  }

  return `prompts: 新建 ${created}，新版本 ${versioned}，跳过 ${skipped}`;
}

async function syncIntent(): Promise<string> {
  const groups = await api(LOCAL_API, LOCAL_TOKEN, '/v1/admin/intent-examples');
  let updated = 0;
  let skipped = 0;

  for (const group of groups ?? []) {
    if (!group.examples?.length) { skipped++; continue; }
    const domain = group.name;
    if (DRY_RUN) {
      console.log(`  ↻ intent ${domain} (${group.examples.length})`);
      continue;
    }
    try {
      await api(TARGET_API, TARGET_TOKEN, `/v1/admin/intent-examples/${domain}`, {
        method: 'PUT',
        body: JSON.stringify({ sentences: group.examples, mode: 'replace' }),
      });
      updated++;
      console.log(`  ✅ intent ${domain} ← ${group.examples.length} 条`);
    } catch (e: any) {
      skipped++;
      console.log(`  ❌ intent ${domain} → ${e.message}`);
    }
    await sleep(DELAY);
  }

  return `intent: 更新 ${updated} 个域，跳过/失败 ${skipped}`;
}

async function main() {
  console.log('\n🔁 AI 数据同步');
  console.log('=========================================');
  console.log(`  LOCAL  : ${LOCAL_API}`);
  console.log(`  TARGET : ${TARGET_API}`);
  console.log(`  MODE   : ${DRY_RUN ? 'DRY RUN' : '真实写入'}`);

  if (!DRY_RUN && (!LOCAL_TOKEN || !TARGET_TOKEN)) {
    throw new Error('缺少 LOCAL_TOKEN / TARGET_TOKEN');
  }

  const results: string[] = [];
  if (process.env.SKIP_KNOWLEDGE !== '1') results.push(await syncKnowledge());
  if (process.env.SKIP_PROMPTS !== '1') results.push(await syncPrompts());
  if (process.env.SKIP_INTENT !== '1') results.push(await syncIntent());

  console.log('\n=========================================');
  results.forEach((r) => console.log(`  ${r}`));
  console.log('');
}

main().catch((e) => {
  console.error('\n❌ 同步失败:', e.message, '\n');
  process.exit(1);
});
