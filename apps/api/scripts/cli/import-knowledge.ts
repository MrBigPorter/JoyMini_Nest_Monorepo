/**
 * 📚 批量导入知识库
 * ============================================================
 * 直接调 admin API（POST /v1/admin/rag/documents/upload），
 * 把 knowledge 目录下的 .md 一次性全传上去，
 * 省掉在后台一个个点的 27 次操作。
 *
 * 用法:
 *   yarn workspace @lucky/api import-knowledge
 *   ADMIN_USERNAME=porter yarn workspace @lucky/api import-knowledge
 *   API_BASE=http://admin-dev.joyminis.com/api yarn workspace @lucky/api import-knowledge
 *   yarn workspace @lucky/api import-knowledge -- --dry-run
 *
 * 设计要点:
 *   1. 密码用隐藏输入读，不落盘、不进 shell 历史
 *   2. 串行上传 — 每个文件会触发切分 + 投递一条 BullMQ 向量化任务，
 *      并行只是把任务堆进队列，总耗时不变
 *   3. 429 / 5xx 自动重试（指数退避），单个文件失败不中断整批
 *   4. 上传成功后后端返回 action: 'created' | 'updated'
 *      —— 因为 uploadFile 是按 docId_locale 做 upsert 的
 * ============================================================
 */
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { createInterface } from 'readline';

// ── 配置 ────────────────────────────────────────────────────────
/** 走 nginx：宿主机 -> nginx:80 -> backend:3000（backend 只 expose，没 ports） */
const API_BASE = (
  process.env.API_BASE || 'http://localhost/api'
).replace(/\/$/, '');

/** 知识库源目录（yarn workspace 会把 cwd 切到 apps/api） */
const KNOWLEDGE_DIR = resolve(
  process.cwd(),
  'src/client/ai-customer/knowledge',
);

/** 串行上传，留一点间隔避免撞限流 */
const DELAY_MS = Number(process.env.IMPORT_DELAY_MS || 200);

/** 单个文件最多重试次数 */
const RETRY_MAX = 3;

const DRY_RUN = process.argv.includes('--dry-run');

// ── 工具 ────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 隐藏输入密码（复用 create-admin.ts 的原始模式思路） */
function askPassword(question: string): Promise<string> {
  return new Promise((done) => {
    process.stdout.write(question);

    if (process.stdout.isTTY && process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');

      let password = '';
      const handler = (ch: string) => {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', handler);
          process.stdout.write('\n');
          done(password);
          return;
        }
        if (ch === '\u0003') {
          process.stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007F') {
          if (password.length > 0) {
            password = password.slice(0, -1);
            process.stdout.clearLine(0);
            process.stdout.cursorTo(0);
            process.stdout.write(question + '*'.repeat(password.length));
          }
          return;
        }
        password += ch;
        process.stdout.write('*');
      };
      process.stdin.on('data', handler);
      return;
    }

    // 非 TTY（管道 / CI）
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      done(answer.trim());
    });
  });
}

/** 递归收集 .md / .pdf，跳过 _ 开头的目录（如 _archived） */
function collectFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;

    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full));
    } else if (entry.name.endsWith('.md') || entry.name.endsWith('.pdf')) {
      out.push(full);
    }
  }
  return out.sort();
}

// ── API 调用 ────────────────────────────────────────────────────

/**
 * 登录拿 accessToken。响应被全局拦截器包了一层 { code, message, data }
 *
 * ⚠️ 路径必须是 /v1/auth/admin/login（不是 /v1/admin/auth/login）：
 * CsrfMiddleware 对 `/api/v1/auth/` 前缀免检，写错路径会被 403 "CSRF token missing"。
 */
async function login(username: string, password: string): Promise<string> {
  const res = await fetch(`${API_BASE}/v1/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`登录失败 HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const payload = (await res.json()) as {
    data?: { tokens?: { accessToken?: string } };
    tokens?: { accessToken?: string };
  };
  const token = payload.data?.tokens?.accessToken ?? payload.tokens?.accessToken;
  if (!token) {
    throw new Error(`登录响应里没有 accessToken: ${JSON.stringify(payload).slice(0, 300)}`);
  }
  return token;
}

/**
 * 上传单个文件。
 * 成功返回后端给的 action（created / updated），失败抛错。
 */
async function uploadOne(
  token: string,
  filePath: string,
): Promise<'created' | 'updated'> {
  const name = filePath.slice(filePath.lastIndexOf('/') + 1);
  const buffer = readFileSync(filePath);

  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(buffer)], { type: 'text/markdown' }),
    name,
  );

  let lastError = '';

  for (let attempt = 1; attempt <= RETRY_MAX; attempt++) {
    const res = await fetch(`${API_BASE}/v1/admin/rag/documents/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    // 成功
    if (res.ok) {
      const payload = (await res.json()) as {
        data?: { action?: 'created' | 'updated' };
        action?: 'created' | 'updated';
      };
      const action = payload.data?.action ?? payload.action;
      return action === 'updated' ? 'updated' : 'created';
    }

    lastError = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;

    // 只有限流和 5xx 值得重试；4xx（校验失败、越权）重试也没用
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === RETRY_MAX) break;

    const backoff = 1000 * attempt;
    console.log(`      ↻ ${res.status}，${backoff}ms 后重试 (${attempt}/${RETRY_MAX})`);
    await sleep(backoff);
  }

  throw new Error(lastError);
}

// ── 主流程 ──────────────────────────────────────────────────────
async function main() {
  console.log('\n📚 知识库批量导入');
  console.log('=========================================');
  console.log(`  API      : ${API_BASE}`);
  console.log(`  源目录   : ${KNOWLEDGE_DIR}`);
  console.log(`  模式     : ${DRY_RUN ? 'DRY RUN（只列文件，不上传）' : '真实上传'}\n`);

  const files = collectFiles(KNOWLEDGE_DIR);
  if (files.length === 0) {
    console.error(`❌ 没找到任何 .md/.pdf：${KNOWLEDGE_DIR}`);
    process.exit(1);
  }

  console.log(`找到 ${files.length} 个文件：`);
  for (const f of files) {
    console.log(`  · ${f.replace(KNOWLEDGE_DIR + '/', '')}`);
  }
  console.log('');

  if (DRY_RUN) {
    console.log('✅ DRY RUN 结束，未上传任何文件。\n');
    return;
  }

  // ── 登录 ──
  const username = process.env.ADMIN_USERNAME || 'admin';
  console.log(`→ 以 ${username} 登录 ${API_BASE} ...`);

  // 密码优先取环境变量（CI 用），否则隐藏输入
  const password =
    process.env.ADMIN_PASSWORD || (await askPassword('  密码 (Password): '));
  if (!password) {
    console.error('❌ 密码不能为空');
    process.exit(1);
  }

  const token = await login(username, password);
  console.log('  ✅ 登录成功\n');

  // ── 上传 ──
  const started = Date.now();
  const failed: { file: string; reason: string }[] = [];
  let created = 0;
  let updated = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const rel = file.replace(KNOWLEDGE_DIR + '/', '');
    const tag = `[${i + 1}/${files.length}]`;

    try {
      const action = await uploadOne(token, file);
      if (action === 'updated') updated++;
      else created++;
      console.log(`  ✅ ${tag} ${rel} → ${action}`);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      failed.push({ file: rel, reason });
      console.log(`  ❌ ${tag} ${rel} → ${reason}`);
    }

    if (i < files.length - 1) await sleep(DELAY_MS);
  }

  // ── 汇总 ──
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log('\n=========================================');
  console.log(`  成功 ${created + updated} / ${files.length}（新建 ${created}，更新 ${updated}）`);
  console.log(`  耗时 ${secs}s`);

  if (failed.length > 0) {
    console.log(`\n  ❌ 失败 ${failed.length} 个：`);
    for (const f of failed) {
      console.log(`     ${f.file}\n       ${f.reason}`);
    }
  }

  console.log('\n⚠️  上传 ≠ 入库完成。切分后向量化是异步的（BullMQ），');
  console.log('    跑下面这条看真实进度：');
  console.log('    docker exec lucky-db psql -U postgres -d joy_mini -c \\');
  console.log('      "select process_status, count(*) from knowledge_documents group by 1;"\n');

  if (failed.length > 0) process.exit(1);
}

main().catch((err: Error) => {
  console.error('\n❌ 导入失败:', err.message, '\n');
  process.exit(1);
});
