#!/usr/bin/env tsx
/**
 * 📝 批量导入博客文章脚本
 * ============================================================
 *
 * 从 docs/blog/articles/ 目录读取 Markdown 文件，通过 API 批量创建博客文章。
 * 只导入中文内容，后台会自动翻译成其他语言。
 *
 * 用法:
 *   tsx scripts/batch-import-blog-articles.ts
 *
 * 脚本会交互式询问:
 *   - API 地址 (默认 http://localhost:3000/api)
 *   - 管理员用户名
 *   - 管理员密码
 *   - 导入后状态: PUBLISHED 或 DRAFT
 *
 * ═══════════════════════════════════════════════════════════
 * 📐 文档格式规范
 * ═══════════════════════════════════════════════════════════
 *
 * 每个 .md 文件必须遵循以下格式:
 *
 *   # 文章标题
 *   > 文章摘要（可选，用于列表页展示）
 *   ---
 *   正文内容从这里开始...
 *   支持标准 Markdown 语法
 *
 * 字段说明:
 *   ┌──────────┬──────────────────────────────────────────────┐
 *   │ 标题      │ 第一个 # 开头的行，作为 title.zh              │
 *   │ 摘要      │ 标题之后第一个 > 开头的行，作为 excerpt.zh    │
 *   │           │ （可选，没有则留空）                          │
 *   │ 正文      │ --- 分隔线之后的所有内容，作为 content.zh     │
 *   │           │ （如果没有 ---，则从摘要之后开始）             │
 *   └──────────┴──────────────────────────────────────────────┘
 *
 * 示例:
 *   # Next.js 打包体积优化实战
 *   > 从 2MB 到 800KB 的系统化方法，附可复用检查清单
 *   ---
 *   ## 1. 背景
 *   正文内容...
 *
 *   ## 2. 优化一
 *   更多内容...
 *
 * ═══════════════════════════════════════════════════════════
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// ── 类型 ──────────────────────────────────────────────────────────

interface ArticleFile {
  /** 文件名 (不含路径) */
  filename: string;
  /** 从 Markdown 解析出的标题 (第一个 # 行) */
  title: string;
  /** 从 Markdown 解析出的摘要 (第一个 > 行，可选) */
  excerpt: string;
  /** 从 Markdown 解析出的正文内容 */
  content: string;
  /** 完整文件路径 */
  filepath: string;
}

interface CreateArticlePayload {
  title: { zh: string };
  content: { zh: string };
  excerpt?: { zh: string };
  status: 'DRAFT' | 'PUBLISHED';
}

interface ApiResponse {
  id?: string;
  message?: string;
  [key: string]: unknown;
}

// ── 工具函数 ──────────────────────────────────────────────────────

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

/**
 * 解析 Markdown 文件，提取标题、摘要和正文。
 *
 * 格式规范:
 *   # 标题                    ← 必填，第一个 # 行
 *   > 摘要                    ← 可选，标题后第一个 > 行
 *   ---                       ← 可选，分隔正文
 *   正文...                   ← 正文内容
 *
 * @param filepath - .md 文件路径
 * @returns 解析后的文章数据
 * @throws 如果找不到标题则抛出错误
 */
function parseMarkdownFile(filepath: string): ArticleFile {
  const raw = fs.readFileSync(filepath, 'utf-8');
  const lines = raw.split('\n');

  // ── 1. 提取标题 ──────────────────────────────────────────────
  let titleLineIndex = -1;
  let title = '';
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('# ')) {
      title = trimmed.replace(/^#\s+/, '').trim();
      titleLineIndex = i;
      break;
    }
  }

  if (!title) {
    throw new Error(
      `无法从文件 ${path.basename(filepath)} 中找到 # 标题。` +
        `\n      请确保文件第一行是 "# 文章标题" 格式。`,
    );
  }

  // ── 2. 提取摘要 ──────────────────────────────────────────────
  // 标题之后，查找第一个 > 开头的行
  let excerpt = '';
  let excerptLineIndex = -1;
  for (let i = titleLineIndex + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('> ')) {
      excerpt = trimmed.replace(/^>\s+/, '').trim();
      excerptLineIndex = i;
      break;
    }
    // 如果遇到 --- 或空行后出现非 > 内容，停止查找摘要
    if (trimmed === '---' || (trimmed !== '' && !trimmed.startsWith('>'))) {
      break;
    }
  }

  // ── 3. 提取正文 ──────────────────────────────────────────────
  // 正文从 --- 分隔线之后开始
  // 如果没有 ---，则从摘要行之后开始
  // 如果既没有 --- 也没有摘要，则从标题之后开始
  let contentStartIndex = titleLineIndex + 1;

  // 先找 --- 分隔线
  for (let i = titleLineIndex + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '---') {
      contentStartIndex = i + 1;
      break;
    }
  }

  // 如果没有 --- 但有摘要，从摘要之后开始
  if (contentStartIndex === titleLineIndex + 1 && excerptLineIndex !== -1) {
    contentStartIndex = excerptLineIndex + 1;
  }

  const bodyLines = lines.slice(contentStartIndex);
  const content = bodyLines.join('\n').trim();

  if (!content) {
    throw new Error(
      `文件 ${path.basename(filepath)} 的正文内容为空。` +
        `\n      请在标题/摘要之后添加正文内容。`,
    );
  }

  return {
    filename: path.basename(filepath),
    title,
    excerpt,
    content,
    filepath,
  };
}

/**
 * 扫描目录下所有 .md 文件
 */
function scanMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    console.error(`  ❌ 目录不存在: ${dir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(dir);
  return files
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(dir, f))
    .sort();
}

/**
 * 调用 API 登录获取 JWT token
 */
async function login(
  apiBase: string,
  username: string,
  password: string,
): Promise<string> {
  const url = `${apiBase.replace(/\/+$/, '')}/auth/admin/login`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`登录失败 (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    tokens?: { accessToken?: string };
    accessToken?: string;
  };

  // 兼容两种响应格式
  const token =
    data?.tokens?.accessToken || data?.accessToken || (data as unknown as string);

  if (!token) {
    throw new Error(`登录响应中未找到 accessToken: ${JSON.stringify(data)}`);
  }

  return token as string;
}

/**
 * 调用 API 创建文章
 */
async function createArticle(
  apiBase: string,
  token: string,
  article: ArticleFile,
  status: 'DRAFT' | 'PUBLISHED',
): Promise<ApiResponse> {
  const url = `${apiBase.replace(/\/+$/, '')}/admin/blog/articles`;
  const payload: CreateArticlePayload = {
    title: { zh: article.title },
    content: { zh: article.content },
    status,
  };

  // 如果有摘要，一并提交
  if (article.excerpt) {
    payload.excerpt = { zh: article.excerpt };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`创建文章失败 (${response.status}): ${text}`);
  }

  return response.json() as Promise<ApiResponse>;
}

// ── 主逻辑 ────────────────────────────────────────────────────────

async function main() {
  console.log('\n📝  批量导入博客文章');
  console.log('=========================================');
  console.log('  从 docs/blog/articles/ 读取 Markdown 文件');
  console.log('  通过 API 批量创建博客文章');
  console.log('  按 Ctrl+C 随时退出\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // ── Step 1: API 地址 ──────────────────────────────────────────
  const defaultApiUrl = 'http://localhost:3000/api';
  const apiBase =
    (await ask(rl, `API 地址 (默认 ${defaultApiUrl}): `)) || defaultApiUrl;

  // ── Step 2: 管理员登录 ────────────────────────────────────────
  const username = await ask(rl, '管理员用户名: ');
  if (!username) {
    console.log('  ❌ 用户名不能为空\n');
    rl.close();
    return;
  }

  const password = await ask(rl, '管理员密码: ');
  if (!password) {
    console.log('  ❌ 密码不能为空\n');
    rl.close();
    return;
  }

  console.log('\n→ 正在登录...');
  let token: string;
  try {
    token = await login(apiBase, username, password);
    console.log('  ✅ 登录成功\n');
  } catch (err) {
    console.error(`  ❌ ${(err as Error).message}\n`);
    rl.close();
    return;
  }

  // ── Step 3: 扫描 Markdown 文件 ────────────────────────────────
  const articlesDir = path.resolve(__dirname, '../docs/blog/articles');
  const mdFiles = scanMarkdownFiles(articlesDir);

  if (mdFiles.length === 0) {
    console.log(`  ❌ ${articlesDir} 目录下没有 .md 文件\n`);
    rl.close();
    return;
  }

  console.log(`  找到 ${mdFiles.length} 个 Markdown 文件:\n`);
  const articles: ArticleFile[] = [];
  for (const filepath of mdFiles) {
    try {
      const article = parseMarkdownFile(filepath);
      articles.push(article);
      console.log(`  📄 ${article.filename}`);
      console.log(`     标题: ${article.title}`);
      if (article.excerpt) {
        console.log(`     摘要: ${article.excerpt.slice(0, 60)}${article.excerpt.length > 60 ? '...' : ''}`);
      }
      console.log(`     正文: ${article.content.length} 字符\n`);
    } catch (err) {
      console.error(`  ❌ 解析失败: ${(err as Error).message}\n`);
    }
  }

  if (articles.length === 0) {
    console.log('  没有可导入的文章，退出。\n');
    rl.close();
    return;
  }

  // ── Step 4: 选择导入状态 ──────────────────────────────────────
  const statusInput = await ask(rl, '导入状态 (1=发布, 2=草稿, 默认 1): ');
  const status: 'DRAFT' | 'PUBLISHED' = statusInput === '2' ? 'DRAFT' : 'PUBLISHED';
  console.log(`  → 状态: ${status === 'PUBLISHED' ? '已发布' : '草稿'}\n`);

  // ── Step 5: 确认导入 ──────────────────────────────────────────
  console.log('  即将导入以下文章:');
  articles.forEach((a, i) => {
    console.log(`    ${i + 1}. ${a.title}`);
  });
  console.log('');

  const confirm = await ask(rl, `确认导入以上 ${articles.length} 篇文章? (y/N): `);
  if (confirm.toLowerCase() !== 'y') {
    console.log('\n  已取消，未作任何修改。\n');
    rl.close();
    return;
  }

  rl.close();

  // ── Step 6: 批量导入 ──────────────────────────────────────────
  console.log('\n→ 开始批量导入...\n');

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    const prefix = `[${i + 1}/${articles.length}]`;

    try {
      process.stdout.write(`  ${prefix} 正在导入: ${article.title} ... `);
      const result = await createArticle(apiBase, token, article, status);
      successCount++;
      console.log(`✅ 成功 (ID: ${result.id || 'ok'})`);
    } catch (err) {
      failCount++;
      console.log(`❌ 失败`);
      console.error(`     ${(err as Error).message}`);
    }
  }

  // ── 汇总报告 ──────────────────────────────────────────────────
  console.log('\n=========================================');
  console.log('  📊 导入完成');
  console.log('=========================================');
  console.log(`  总计: ${articles.length} 篇`);
  console.log(`  ✅ 成功: ${successCount} 篇`);
  console.log(`  ❌ 失败: ${failCount} 篇`);
  console.log(`  状态: ${status === 'PUBLISHED' ? '已发布' : '草稿'}`);

  if (successCount > 0) {
    console.log('\n  💡 后台会自动翻译文章到英文，请稍后查看翻译进度。');
    console.log('  💡 如需设置分类/标签，请在后台编辑文章。');
  }

  console.log('');
}

main().catch((err: Error) => {
  console.error('\n❌ 脚本执行失败:', err.message);
  process.exit(1);
});
