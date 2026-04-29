#!/usr/bin/env tsx
/**
 * 📝 批量导入博客文章脚本
 * ============================================================
 *
 * 从 docs/blog/articles/ 目录递归读取 Markdown 文件，通过 API 批量创建博客文章。
 * 只导入中文内容，后台会自动翻译成其他语言。
 *
 * 用法:
 *   # 交互式模式
 *   tsx scripts/batch-import-blog-articles.ts
 *
 *   # 非交互式模式（通过环境变量）
 *   API_URL=http://localhost:3000/api \
 *   ADMIN_USERNAME=admin \
 *   ADMIN_PASSWORD=secret \
 *   PUBLISH_STATUS=PUBLISHED \
 *   tsx scripts/batch-import-blog-articles.ts
 *
 *   # 预览模式（不实际创建文章）
 *   DRY_RUN=true tsx scripts/batch-import-blog-articles.ts
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
 *   Tags: Tag1, Tag2, Tag3（可选）
 *   正文内容从这里开始...
 *
 * 字段说明:
 *   ┌──────────┬──────────────────────────────────────────────┐
 *   │ 标题      │ 第一个 # 开头的行，作为 title.zh              │
 *   │ 摘要      │ 标题之后第一个 > 开头的行，作为 excerpt.zh    │
 *   │           │ （可选，没有则留空）                          │
 *   │ 标签      │ --- 之后 Tags: 开头的行，逗号分隔            │
 *   │           │ （可选，没有则不关联标签）                    │
 *   │ 正文      │ --- 分隔线之后（跳过 Tags: 行）的内容        │
 *   └──────────┴──────────────────────────────────────────────┘
 *
 * 示例:
 *   # Next.js 打包体积优化实战
 *   > 从 2MB 到 800KB 的系统化方法，附可复用检查清单
 *   ---
 *   Tags: Next.js, Performance, Bundle Size
 *   ## 1. 背景
 *   正文内容...
 *
 * ═══════════════════════════════════════════════════════════
 * 🏷️ 分类映射
 * ═══════════════════════════════════════════════════════════
 *
 * 脚本会根据文件所在子目录自动映射分类：
 *   articles/performance/  → performance (性能优化)
 *   articles/frontend/     → frontend (前端开发)
 *
 * 可以通过 CATEGORY_MAP 环境变量覆盖映射关系（JSON 格式）。
 * ═══════════════════════════════════════════════════════════
 *
 * ⚡ 自动去重
 * ═══════════════════════════════════════════════════════════
 *
 * 脚本会根据文件名生成 slug，调用 GET /admin/blog/articles/slug/:slug
 * 检查文章是否已存在。已存在的文章会被跳过，避免重复导入。
 * ═══════════════════════════════════════════════════════════
 *
 * 🏷️ 标签自动管理
 * ═══════════════════════════════════════════════════════════
 *
 * 脚本会自动处理 Tags: 元数据中的标签：
 * 1. 搜索标签是否存在 (GET /admin/blog/tags?search=xxx)
 * 2. 不存在则创建 (POST /admin/blog/tags)
 * 3. 将标签 ID 关联到文章 (tagIds)
 * ═══════════════════════════════════════════════════════════
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

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
  /** 从 Markdown 解析出的标签列表 (Tags: 行) */
  tags: string[];
  /** 完整文件路径 */
  filepath: string;
  /** 相对于 articles/ 的目录名（用于分类映射） */
  subdir: string | null;
}

interface CreateArticlePayload {
  title: { zh: string };
  content: { zh: string };
  excerpt?: { zh: string };
  status: "DRAFT" | "PUBLISHED";
  categoryId?: string;
  /** 关联的标签 ID 列表 */
  tagIds?: string[];
}

interface ApiResponse {
  id?: string;
  message?: string;
  [key: string]: unknown;
}

// ── 常量 ──────────────────────────────────────────────────────────

/**
 * 子目录名称 → 分类 Slug 映射
 * 当文件位于 articles/{subdir}/ 下时，自动关联对应分类。
 * 分类 Slug 需要先在后台创建，且与数据库中的 slug 字段一致。
 *
 * 可以通过环境变量 CATEGORY_MAP 覆盖（JSON 格式）:
 *   CATEGORY_MAP='{"performance":"performance","frontend":"frontend"}'
 */
const DEFAULT_CATEGORY_MAP: Record<string, string> = {
  performance: "performance",
  frontend: "frontend",
};

/**
 * 解析 CATEGORY_MAP，优先使用环境变量，否则使用默认值
 */
function getCategoryMap(): Record<string, string> {
  if (process.env.CATEGORY_MAP) {
    try {
      return JSON.parse(process.env.CATEGORY_MAP) as Record<string, string>;
    } catch {
      console.warn(
        "  ⚠️  环境变量 CATEGORY_MAP 格式无效 (应为 JSON)，使用默认映射",
      );
    }
  }
  return DEFAULT_CATEGORY_MAP;
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
  const raw = fs.readFileSync(filepath, "utf-8");
  const lines = raw.split("\n");

  // ── 1. 提取标题 ──────────────────────────────────────────────
  let titleLineIndex = -1;
  let title = "";
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("# ")) {
      title = trimmed.replace(/^#\s+/, "").trim();
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
  let excerpt = "";
  let excerptLineIndex = -1;
  for (let i = titleLineIndex + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("> ")) {
      excerpt = trimmed.replace(/^>\s+/, "").trim();
      excerptLineIndex = i;
      break;
    }
    // 如果遇到 --- 或空行后出现非 > 内容，停止查找摘要
    if (trimmed === "---" || (trimmed !== "" && !trimmed.startsWith(">"))) {
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
    if (trimmed === "---") {
      contentStartIndex = i + 1;
      break;
    }
  }

  // 如果没有 --- 但有摘要，从摘要之后开始
  if (contentStartIndex === titleLineIndex + 1 && excerptLineIndex !== -1) {
    contentStartIndex = excerptLineIndex + 1;
  }

  const bodyLines = lines.slice(contentStartIndex);

  // ── 4. 提取 Tags ────────────────────────────────────────────
  // Tags 行格式: Tags: Tag1, Tag2, Tag3
  // 位于正文开头，单独一行
  const tags: string[] = [];
  const firstBodyLine = bodyLines[0]?.trim() || "";
  const tagsMatch = firstBodyLine.match(/^Tags:\s*(.+)$/i);
  if (tagsMatch) {
    const rawTags = tagsMatch[1];
    tags.push(
      ...rawTags
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
    );
    // 移除 Tags 行，不把它作为正文内容
    bodyLines.shift();
  }

  const content = bodyLines.join("\n").trim();

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
    tags,
    content,
    filepath,
    subdir: null, // 调用方填充
  };
}

/**
 * 递归扫描目录下所有 .md 文件，保留子目录信息
 */
function scanMarkdownFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    console.error(`  ❌ 目录不存在: ${dir}`);
    process.exit(1);
  }

  const results: string[] = [];

  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results.sort();
}

/**
 * 获取文件相对于 articles/ 目录的子目录名
 * 例如: docs/blog/articles/frontend/foo.md → "frontend"
 */
function getSubdirectory(
  filepath: string,
  articlesDir: string,
): string | null {
  const rel = path.relative(articlesDir, filepath);
  const dir = path.dirname(rel);
  // 如果文件直接在 articles/ 下（没有子目录），返回 null
  if (dir === ".") return null;
  // 取第一层子目录名
  return dir.split(path.sep)[0];
}

/**
 * 调用 API 登录获取 JWT token
 */
async function login(
  apiBase: string,
  username: string,
  password: string,
): Promise<string> {
  const url = `${apiBase.replace(/\/+$/, "")}/v1/auth/admin/login`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
    data?.tokens?.accessToken ||
    data?.accessToken ||
    (data as unknown as string);

  if (!token) {
    throw new Error(`登录响应中未找到 accessToken: ${JSON.stringify(data)}`);
  }

  return token as string;
}

/**
 * 根据文件名生成 slug
 * 例如: "blog-video-hls-transcoding-practice.md" → "blog-video-hls-transcoding-practice"
 */
function filenameToSlug(filename: string): string {
  return filename.replace(/\.md$/i, "");
}

/**
 * 检查文章是否已存在（按 slug 去重）
 * 调用 GET /admin/blog/articles/slug/:slug
 * 返回文章 ID 或 null
 */
async function findArticleBySlug(
  apiBase: string,
  token: string,
  slug: string,
): Promise<string | null> {
  const url = `${apiBase.replace(/\/+$/, "")}/v1/admin/blog/articles/slug/${encodeURIComponent(slug)}`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      const data = (await response.json()) as { id?: string };
      return data?.id || null;
    }
    // 404 表示不存在
    if (response.status === 404) return null;
    // 其他错误
    const text = await response.text();
    console.warn(`     ⚠️  检查 slug 时出错 (${response.status}): ${text}`);
    return null;
  } catch {
    return null;
  }
}

/**
 * 查找或创建标签
 *
 * 1. 搜索已有标签 (GET /admin/blog/tags?search=xxx)
 * 2. 如果找到，返回第一个匹配的 ID
 * 3. 如果未找到，创建新标签 (POST /admin/blog/tags)
 * 4. 标签名同时设 zh 和 en（技术术语通用）
 */
async function findOrCreateTag(
  apiBase: string,
  token: string,
  tagName: string,
): Promise<string | null> {
  const baseUrl = apiBase.replace(/\/+$/, "");

  // ── 搜索已有标签 ──────────────────────────────────────────
  const searchUrl = `${baseUrl}/v1/admin/blog/tags?search=${encodeURIComponent(tagName)}`;
  try {
    const searchRes = await fetch(searchUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (searchRes.ok) {
      const tags = (await searchRes.json()) as Array<{ id: string; name: Record<string, string> }>;
      // 精确匹配（忽略大小写）
      const exactMatch = tags.find((t) => {
        const nameValues = Object.values(t.name || {}).filter(Boolean) as string[];
        return nameValues.some((n) => n.toLowerCase() === tagName.toLowerCase());
      });
      if (exactMatch) {
        return exactMatch.id;
      }
    }
  } catch {
    // 搜索失败，继续尝试创建
  }

  // ── 创建新标签 ────────────────────────────────────────────
  const createUrl = `${baseUrl}/v1/admin/blog/tags`;
  const body = {
    name: { zh: tagName, en: tagName },
  };

  try {
    const createRes = await fetch(createUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (createRes.ok) {
      const created = (await createRes.json()) as { id: string };
      return created.id;
    }

    // 如果创建失败（可能 slug 冲突），尝试搜索一次
    const retrySearchRes = await fetch(searchUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (retrySearchRes.ok) {
      const tags = (await retrySearchRes.json()) as Array<{ id: string }>;
      if (tags.length > 0) return tags[0].id;
    }

    const text = await createRes.text();
    console.warn(`     ⚠️  创建标签 "${tagName}" 失败 (${createRes.status}): ${text}`);
    return null;
  } catch {
    return null;
  }
}

/**
 * 调用 API 创建文章
 */
async function createArticle(
  apiBase: string,
  token: string,
  article: ArticleFile,
  status: "DRAFT" | "PUBLISHED",
  categoryId?: string,
  tagIds?: string[],
): Promise<ApiResponse> {
  const url = `${apiBase.replace(/\/+$/, "")}/v1/admin/blog/articles`;
  const payload: CreateArticlePayload = {
    title: { zh: article.title },
    content: { zh: article.content },
    status,
  };

  // 如果有摘要，一并提交
  if (article.excerpt) {
    payload.excerpt = { zh: article.excerpt };
  }

  // 如果有分类映射，提交 categoryId
  if (categoryId) {
    payload.categoryId = categoryId;
  }

  // 如果有标签，提交 tagIds
  if (tagIds && tagIds.length > 0) {
    payload.tagIds = tagIds;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
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
  // ── 检测运行模式 ──────────────────────────────────────────────
  const isDryRun = process.env.DRY_RUN === "true" || process.argv.includes("--dry-run");
  const isNonInteractive =
    !!process.env.ADMIN_USERNAME && !!process.env.ADMIN_PASSWORD;

  // ── 环境变量配置 ──────────────────────────────────────────────
  const defaultApiUrl = "http://localhost:3000/api";
  const envApiUrl = process.env.API_URL;
  const envUsername = process.env.ADMIN_USERNAME;
  const envPassword = process.env.ADMIN_PASSWORD;
  const envStatus = (process.env.PUBLISH_STATUS as "DRAFT" | "PUBLISHED") || "PUBLISHED";
  const envSourceDir = process.env.SOURCE_DIR || "docs/blog/articles";
  const categoryMap = getCategoryMap();

  console.log("\n📝  批量导入博客文章");
  console.log("=========================================");
  if (isDryRun) console.log("  🔍 预览模式 (DRY RUN) — 不会实际创建文章");
  if (isNonInteractive) console.log("  🤖 非交互式模式 (使用环境变量)");
  console.log(`  来源: ${envSourceDir}`);
  console.log("  按 Ctrl+C 随时退出\n");

  // ── 解析文章来源目录 ──────────────────────────────────────────
  const articlesDir = path.resolve(__dirname, "..", envSourceDir);

  // ── 交互式输入 (如果非交互式，跳过) ────────────────────────────
  let apiBase = envApiUrl || defaultApiUrl;
  let username = envUsername || "";
  let password = envPassword || "";
  let status: "DRAFT" | "PUBLISHED" = envStatus;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  if (!isNonInteractive) {
    // Step 1: API 地址
    const apiInput = await ask(rl, `API 地址 (默认 ${defaultApiUrl}): `);
    if (apiInput) apiBase = apiInput;

    // Step 2: 管理员登录
    username = await ask(rl, "管理员用户名: ");
    if (!username) {
      console.log("  ❌ 用户名不能为空\n");
      rl.close();
      return;
    }

    password = await ask(rl, "管理员密码: ");
    if (!password) {
      console.log("  ❌ 密码不能为空\n");
      rl.close();
      return;
    }
  }

  // ── Step: 登录 ────────────────────────────────────────────────
  let token: string | null = null;

  if (!isDryRun) {
    console.log("\n→ 正在登录...");
    try {
      token = await login(apiBase, username, password);
      console.log("  ✅ 登录成功\n");
    } catch (err) {
      console.error(`  ❌ ${(err as Error).message}\n`);
      rl.close();
      return;
    }
  } else {
    console.log("\n→ 🔍 预览模式，跳过登录\n");
  }

  // ── Step: 扫描 Markdown 文件 (递归) ──────────────────────────
  const mdFiles = scanMarkdownFilesRecursive(articlesDir);

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
      article.subdir = getSubdirectory(filepath, articlesDir);

      // 显示子目录信息
      const dirLabel = article.subdir ? ` [${article.subdir}]` : "";
      articles.push(article);
      console.log(`  📄 ${article.filename}${dirLabel}`);
      console.log(`     标题: ${article.title}`);
      if (article.excerpt) {
        console.log(
          `     摘要: ${article.excerpt.slice(0, 60)}${article.excerpt.length > 60 ? "..." : ""}`,
        );
      }
      console.log(`     正文: ${article.content.length} 字符`);

      // 显示分类映射
      if (article.subdir && categoryMap[article.subdir]) {
        console.log(`     分类: → ${categoryMap[article.subdir]}`);
      }

      // 显示标签
      if (article.tags && article.tags.length > 0) {
        console.log(`     标签: ${article.tags.join(", ")}`);
      }
      console.log("");
    } catch (err) {
      console.error(`  ❌ 解析失败: ${(err as Error).message}\n`);
    }
  }

  if (articles.length === 0) {
    console.log("  没有可导入的文章，退出。\n");
    rl.close();
    return;
  }

  // ── Step: 选择导入状态 (非交互式跳过) ─────────────────────────
  if (!isNonInteractive) {
    const defaultStatusLabel = status === "PUBLISHED" ? "1" : "2";
    const statusInput = await ask(
      rl,
      `导入状态 (1=发布, 2=草稿, 默认 ${defaultStatusLabel}): `,
    );
    if (statusInput === "1") status = "PUBLISHED";
    else if (statusInput === "2") status = "DRAFT";
    // 否则保持默认
  }

  console.log(`  → 状态: ${status === "PUBLISHED" ? "已发布" : "草稿"}\n`);

  // ── Step: 确认导入 ────────────────────────────────────────────
  console.log("  即将导入以下文章:");
  articles.forEach((a, i) => {
    const catLabel = a.subdir && categoryMap[a.subdir]
      ? ` [${categoryMap[a.subdir]}]`
      : "";
    const tagsLabel = a.tags && a.tags.length > 0
      ? ` 🏷️${a.tags.join(", ")}`
      : "";
    console.log(`    ${i + 1}. ${a.title}${catLabel}${tagsLabel}`);
  });
  console.log("");

  if (!isNonInteractive) {
    const confirm = await ask(
      rl,
      `确认导入以上 ${articles.length} 篇文章? (y/N): `,
    );
    if (confirm.toLowerCase() !== "y") {
      console.log("\n  已取消，未作任何修改。\n");
      rl.close();
      return;
    }
  }

  rl.close();

  // ── 预览模式，到此为止 ──────────────────────────────────────
  if (isDryRun) {
    console.log("\n=========================================");
    console.log("  🔍 预览完成 (DRY RUN)");
    console.log("=========================================");
    console.log(`  共发现 ${articles.length} 篇文章`);
    console.log(`  状态: ${status === "PUBLISHED" ? "已发布" : "草稿"}`);
    console.log("\n  设置 DRY_RUN=false 或移除环境变量后重新运行以实际创建。\n");
    return;
  }

  // ── Step: 批量导入 ────────────────────────────────────────────
  console.log("\n→ 开始批量导入...\n");

  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;
  let tagCreateCount = 0;

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    const prefix = `[${i + 1}/${articles.length}]`;

    // 根据子目录查找分类 ID
    const categorySlug = article.subdir ? categoryMap[article.subdir] : undefined;

    // ── Slug 去重 ──────────────────────────────────────────────
    const slug = filenameToSlug(article.filename);
    try {
      const existingId = await findArticleBySlug(apiBase, token!, slug);
      if (existingId) {
        console.log(`  ${prefix} ⏭️  跳过: ${article.title} (已存在, ID: ${existingId})`);
        skipCount++;
        continue;
      }
    } catch {
      console.warn(`     ⚠️  无法检查 slug "${slug}"，将尝试创建`);
    }

    // ── 处理标签 ──────────────────────────────────────────────
    const tagIds: string[] = [];
    if (article.tags && article.tags.length > 0) {
      for (const tagName of article.tags) {
        try {
          const tagId = await findOrCreateTag(apiBase, token!, tagName);
          if (tagId) {
            tagIds.push(tagId);
            tagCreateCount++;
          }
        } catch {
          console.warn(`     ⚠️  标签 "${tagName}" 处理失败，跳过`);
        }
      }
    }

    try {
      process.stdout.write(`  ${prefix} 正在导入: ${article.title} ... `);
      const result = await createArticle(apiBase, token!, article, status, categorySlug, tagIds);
      successCount++;
      const tagInfo = tagIds.length > 0 ? ` 🏷️${tagIds.length}个标签` : "";
      console.log(`✅ 成功 (ID: ${result.id || "ok"})${categorySlug ? ` [${categorySlug}]` : ""}${tagInfo}`);
    } catch (err) {
      failCount++;
      console.log(`❌ 失败`);
      console.error(`     ${(err as Error).message}`);
    }
  }

  // ── 汇总报告 ──────────────────────────────────────────────────
  console.log("\n=========================================");
  console.log("  📊 导入完成");
  console.log("=========================================");
  console.log(`  总计: ${articles.length} 篇`);
  console.log(`  ✅ 成功: ${successCount} 篇`);
  console.log(`  ⏭️  跳过: ${skipCount} 篇 (已存在)`);
  console.log(`  ❌ 失败: ${failCount} 篇`);
  console.log(`  🏷️  标签关联: ${tagCreateCount} 次`);
  console.log(`  状态: ${status === "PUBLISHED" ? "已发布" : "草稿"}`);

  const categorized = articles.filter((a) => a.subdir && categoryMap[a.subdir]);
  if (categorized.length > 0) {
    console.log(`  已分类: ${categorized.length} 篇 (基于子目录映射)`);
  }

  if (successCount > 0) {
    console.log("\n  💡 后台会自动翻译文章到英文，请稍后查看翻译进度。");
    console.log("  💡 标签已自动关联，分类请到后台确认。");
  }

  console.log("");
}

main().catch((err: Error) => {
  console.error("\n❌ 脚本执行失败:", err.message);
  process.exit(1);
});
