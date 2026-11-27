#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { loadRegistry } from "./registry.mjs";
import { SourceError, createHttpSource } from "./source.mjs";

const USAGE = `用法：node tools/truth/apply-docs.mjs --base-url <url> [--docs a,b] [--dry-run]

把 tools/truth/fixtures/docs/<docId>.md 的定稿内容写回 dev 环境的知识库文档。

  --base-url        API 根地址（含版本前缀），例如 http://127.0.0.1:3000/api/v1（也可用环境变量 TRUTH_BASE_URL）
  --token           管理员 Bearer 令牌（也可用环境变量 TRUTH_ADMIN_TOKEN，推荐走环境变量）
  --docs            只处理这些文档 docId（逗号分隔），缺省处理登记里的全部文档
  --dry-run         只列出哪些文档会变，不发写请求
  --poll-interval-ms  轮询 activeVersion 的间隔，默认 2000
  --poll-timeout-ms   等待 activeVersion 切换的上限，默认 180000

写回走 PATCH /admin/rag/documents/:id/content：内容变更 → 重新切片/向量化 →
KbVersionService 切换 activeVersion，索引才会跟上。直接改库会让索引停在旧内容。

退出码：0 = 全部已写入并生效（或本来就一致）；1 = 任一文档失败。`;

function failUsage(message) {
  process.stderr.write(`${message}\n\n${USAGE}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.TRUTH_BASE_URL,
    token: process.env.TRUTH_ADMIN_TOKEN,
    docIds: undefined,
    dryRun: false,
    pollIntervalMs: 2000,
    pollTimeoutMs: 180000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--base-url") {
      options.baseUrl = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--token") {
      options.token = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--docs") {
      options.docIds = (argv[index + 1] ?? "")
        .split(",")
        .map((docId) => docId.trim())
        .filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === "--poll-interval-ms") {
      options.pollIntervalMs = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--poll-timeout-ms") {
      options.pollTimeoutMs = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    failUsage(`未知参数：${arg}`);
  }

  return options;
}

function fixtureContent(docId) {
  const path = new URL(`./fixtures/docs/${docId}.md`, import.meta.url);
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(`找不到定稿文件 fixtures/docs/${docId}.md`);
  }
}

/** 直接发 PATCH（这是运维工具，不是校验器；校验器只发 GET）。 */
async function patchContent({ root, token, id, content }) {
  const pathname = `/admin/rag/documents/${id}/content`;
  let response;
  try {
    response = await fetch(`${root}${pathname}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ content }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (error) {
    throw new SourceError(`请求失败：PATCH ${pathname}：${error?.message ?? error}`);
  }
  if (!response.ok) throw new SourceError(`HTTP ${response.status}：PATCH ${pathname}`);

  let body;
  try {
    body = await response.json();
  } catch {
    throw new SourceError(`来源结构不符：PATCH ${pathname} 返回的不是 JSON`);
  }
  if (!body || body.code !== 10000) {
    throw new SourceError(`业务错误码 ${body?.code}：PATCH ${pathname}：${body?.message ?? ""}`);
  }
  if (!body.data || typeof body.data.version !== "number") {
    throw new SourceError(`来源结构不符：PATCH ${pathname} 没有返回 version`);
  }
  return body.data.version;
}

async function getJson({ root, token, pathname }) {
  let response;
  try {
    response = await fetch(`${root}${pathname}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new SourceError(`请求失败：GET ${pathname}：${error?.message ?? error}`);
  }
  if (!response.ok) throw new SourceError(`HTTP ${response.status}：GET ${pathname}`);
  const body = await response.json();
  if (!body || body.code !== 10000) {
    throw new SourceError(`业务错误码 ${body?.code}：GET ${pathname}：${body?.message ?? ""}`);
  }
  return body.data;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 等 KbVersionService 把 activeVersion 切到刚写入的 version。 */
async function waitForActive({ root, token, id, docId, version, intervalMs, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const document = await getJson({ root, token, pathname: `/admin/rag/documents/${id}` });
    if (!document || typeof document.version !== "number") {
      throw new SourceError(`来源结构不符：文档「${docId}」详情缺 version`);
    }
    if (document.activeVersion === version) return document;
    if (Date.now() >= deadline) {
      throw new SourceError(
        `文档「${docId}」写入 version ${version} 后 ${timeoutMs}ms 内 activeVersion 未切换（当前 version ${document.version} / activeVersion ${document.activeVersion}）——索引未生效，请查 embedding 任务`,
      );
    }
    await sleep(intervalMs);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.baseUrl) failUsage("缺少 --base-url（或环境变量 TRUTH_BASE_URL）");
  if (!options.token) failUsage("缺少 --token（或环境变量 TRUTH_ADMIN_TOKEN）");
  if (options.docIds && options.docIds.length === 0) failUsage("--docs 不能为空");

  const registry = loadRegistry();
  const docIds = options.docIds ?? registry.documents;
  for (const docId of docIds) {
    if (!registry.documents.includes(docId)) failUsage(`文档「${docId}」不在登记里（登记：${registry.documents.join(", ")}）`);
  }

  const root = options.baseUrl.replace(/\/+$/, "");
  const source = createHttpSource({ baseUrl: root, token: options.token });

  process.stdout.write(`写回定稿：${root}\n`);
  const failures = [];

  for (const docId of docIds) {
    try {
      const wanted = fixtureContent(docId);
      const current = await source.getDocument(docId);

      if (current.content === wanted) {
        process.stdout.write(`${docId} 无需变更（当前 version ${current.version}）\n`);
        continue;
      }
      if (options.dryRun) {
        process.stdout.write(`${docId} 内容不同（当前 version ${current.version}），--dry-run 不写入\n`);
        continue;
      }

      const version = await patchContent({ root, token: options.token, id: current.id, content: wanted });
      process.stdout.write(`${docId} 已提交：version ${current.version} → ${version}，等待 activeVersion 切换…\n`);
      const document = await waitForActive({
        root,
        token: options.token,
        id: current.id,
        docId,
        version,
        intervalMs: options.pollIntervalMs,
        timeoutMs: options.pollTimeoutMs,
      });
      process.stdout.write(`${docId} 已生效：version ${document.version}，activeVersion ${document.activeVersion}\n`);
    } catch (error) {
      failures.push({ docId, message: error?.message ?? String(error) });
    }
  }

  for (const failure of failures) {
    process.stderr.write(`${failure.docId} 失败：${failure.message}\n`);
  }
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`写回执行失败：${error?.message ?? error}\n`);
  process.exit(1);
});
