#!/usr/bin/env node
import { runCheck } from "./runner.mjs";
import { createHttpSource } from "./source.mjs";

const USAGE = `用法：node tools/truth/check.mjs --base-url <url> --token <管理员令牌> [--docs a,b]

  --base-url  部署环境的 API 根地址（含版本前缀），例如 https://api.joyminis.com/api/v1
              本地：http://127.0.0.1:3000/api/v1
  --token     管理员 Bearer 令牌（也可用环境变量 TRUTH_ADMIN_TOKEN）
  --docs      只校验这些文档 docId（逗号分隔），缺省校验登记里的全部文档

退出码：0 = 全部一致；1 = 存在不一致、来源不可达或登记无法解析。`;

function failUsage(message) {
  process.stderr.write(`${message}\n\n${USAGE}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.TRUTH_BASE_URL,
    token: process.env.TRUTH_ADMIN_TOKEN,
    docIds: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
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
    failUsage(`未知参数：${arg}`);
  }

  return options;
}

const VERDICT_LABEL = { pass: "通过", fail: "失败" };

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.baseUrl) failUsage("缺少 --base-url（或环境变量 TRUTH_BASE_URL）");
  if (!options.token) failUsage("缺少 --token（或环境变量 TRUTH_ADMIN_TOKEN）");
  if (options.docIds && options.docIds.length === 0) failUsage("--docs 不能为空");

  const source = createHttpSource({ baseUrl: options.baseUrl, token: options.token });
  const report = await runCheck({ source, docIds: options.docIds });

  process.stdout.write(`真值校验：${options.baseUrl}\n`);
  if (options.docIds) process.stdout.write(`范围：${options.docIds.join(", ")}\n`);

  for (const result of report.results) {
    const column = result.column ?? "可用性";
    const suffix = result.verdict === "pass" ? "" : `（${result.reason}${result.detail ? `：${result.detail}` : ""}）`;
    process.stdout.write(
      `${result.docId} ${result.key}（${column}） 文档「${result.declared}」 / 真值「${result.truth}」 → ${VERDICT_LABEL[result.verdict]}${suffix}\n`,
    );
  }

  for (const error of report.errors) {
    process.stdout.write(`[${error.kind}] ${error.message}\n`);
  }

  for (const blocker of report.blockers) {
    process.stdout.write(`阻断：${blocker}\n`);
  }

  const passed = report.results.filter((result) => result.verdict === "pass").length;
  const failed = report.results.length - passed;
  process.stdout.write(
    `\n共 ${report.compared} 条比对：${passed} 通过，${failed} 失败；扫描/来源问题 ${report.errors.length} 条，阻断 ${report.blockers.length} 条\n`,
  );

  process.exit(report.status === "pass" ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`校验执行失败：${error?.message ?? error}\n`);
  process.exit(1);
});
