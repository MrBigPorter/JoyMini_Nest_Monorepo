#!/usr/bin/env node
/**
 * 引用核验诊断（citation review）。
 *
 *   node tools/eval/e2e/verify-citations.mjs \
 *     tools/eval/e2e/reports/<run>/detail.json \
 *     [--scope subset|full] [--limit 10] [--doc-ids a,b] \
 *     [--out reports/<run>-citation-review] [--concurrency 3]
 *
 * 做一件事：把一次运行里「依据来自知识库」的回答重新交给判官，
 * 判官按 docId 拉**当前**文档 chunk，核对回答与它引用/应引用的文档是否一致。
 *
 * 抽样规则：
 *   - 子集运行：全查（子集本来就是「变更影响面」）；
 *   - 全量运行：抽 10 条，优先判决翻转的用例，其次与变更文档相关的用例；
 *   - 只抽有真实回答、非兜底、依据分型为 kb 的用例。
 *
 * 只做诊断：不改 kbAccuracy、不升 metric 版本、不写 run 记录。
 * 它能发现「回答与当前文档不一致 / 引用漂移」，不能证明文档内容符合业务真相。
 */
import fs from "node:fs";
import path from "node:path";

import { createAdminApi } from "./admin.mjs";
import { loadConfig } from "./config.mjs";
import { createThrottle } from "./http.mjs";
import { cannedReplyCheck, citedDocIdsFor } from "./judge.mjs";
import { METRIC_SPEC_VERSION } from "./metrics-spec.mjs";

const log = (message) => process.stderr.write(`[verify-citations] ${message}\n`);

export const CITATION_REVIEW_VERSION = "v1";

function short(text, max = 60) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** 用例里记录的 B 判决（v3 优先读 set => `rejudge`，实时运行读 `judge`）。 */
export function recordedVerdict(item) {
  return (
    item?.rejudge?.goldenAgreement ??
    item?.judge?.goldenAgreement ??
    null
  );
}

/** 旧口径判决，用来识别「判决翻转」。 */
export function previousVerdict(item) {
  return item?.judge?.goldenAgreementV1 ?? null;
}

export function verdictFlipped(item) {
  const before = previousVerdict(item)?.faithful;
  const after = recordedVerdict(item)?.faithful;
  return (
    typeof before === "boolean" && typeof after === "boolean" && before !== after
  );
}

function lastRound(item) {
  const rounds = Array.isArray(item?.rounds) ? item.rounds : [];
  return rounds[rounds.length - 1] ?? null;
}

/**
 * 是否进入引用核验：
 *   - 用例成功且有真实回答；
 *   - 不是兜底话术（兜底没有可核对的回答）；
 *   - 依据分型不是工具/兜底（工具事实不在知识库里）；
 *     旧报告没写 `grounding` 时按引用情况判断，不因缺字段整批丢弃；
 *   - 有 golden 文档或实际引用了文档（两者都没有就无从核对）。
 */
export function isCitationEligible(item) {
  if (item?.status !== "ok") return false;
  if (item?.kind !== "knowledge" && item?.kind !== "multi") return false;
  const groundingKind = item?.judge?.grounding?.kind;
  if (groundingKind && groundingKind !== "kb") return false;
  const last = lastRound(item);
  const answer = String(last?.reply?.content ?? "");
  if (!answer || cannedReplyCheck(answer).canned) return false;
  const expected = item?.expectedDocIds ?? [];
  const cited = citedDocIdsFor(expected, last?.reply?.sources ?? []);
  return expected.length > 0 || cited.length > 0;
}

export function citedDocIdsOf(item) {
  const last = lastRound(item);
  return citedDocIdsFor(
    item?.expectedDocIds ?? [],
    last?.reply?.sources ?? [],
  );
}

/**
 * 抽样。
 *
 * @param {Array} cases detail.json 的 cases
 * @param {object} options
 * @param {"subset"|"full"} options.scope
 * @param {number} options.limit 全量时的上限（子集忽略）
 * @param {string[]} options.docIds 本次变更文档 docId（优先级第二）
 * @returns {Array} 选中的用例（保持优先级顺序）
 */
export function selectCitationCases(
  cases,
  { scope = "full", limit = 10, docIds = [] } = {},
) {
  const eligible = (cases ?? []).filter(isCitationEligible);
  if (scope === "subset") return eligible;

  const changed = new Set(docIds ?? []);
  const priority = (item) => {
    if (verdictFlipped(item)) return 0;
    const docs = [
      ...(item.expectedDocIds ?? []),
      ...citedDocIdsOf(item),
    ];
    return docs.some((docId) => changed.has(docId)) ? 1 : 2;
  };

  return eligible
    .map((item, index) => ({ item, index, rank: priority(item) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, Math.max(0, Number(limit) || 0))
    .map((entry) => entry.item);
}

export function parseCitationArgs(argv = []) {
  const args = {
    input: null,
    scope: null,
    limit: 10,
    docIds: [],
    out: null,
    concurrency: 3,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--scope") args.scope = argv[++index] ?? null;
    else if (token === "--limit") args.limit = Number(argv[++index]) || 0;
    else if (token === "--doc-ids") {
      args.docIds = String(argv[++index] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    } else if (token === "--out") args.out = argv[++index] ?? null;
    else if (token === "--concurrency") {
      args.concurrency = Math.min(8, Math.max(1, Number(argv[++index]) || 3));
    } else if (!token.startsWith("-") && !args.input) args.input = token;
  }
  if (args.scope && args.scope !== "subset" && args.scope !== "full") {
    throw new Error(`--scope 只接受 subset / full，收到 ${args.scope}`);
  }
  return args;
}

/**
 * 逐条核验。`judge` 可注入（单测用桩替掉真实判官）。
 */
export async function runCitationReview({
  cases,
  admin,
  scope = "full",
  limit = 10,
  docIds = [],
  concurrency = 3,
  judge = (payload) => admin.judgeFaithfulness(payload),
  onProgress = null,
}) {
  const selected = selectCitationCases(cases, { scope, limit, docIds });
  const records = new Array(selected.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, selected.length) || 1 },
    async () => {
      while (true) {
        const slot = next++;
        if (slot >= selected.length) break;
        const item = selected[slot];
        const last = lastRound(item);
        const question = last?.question ?? "";
        const answer = last?.reply?.content ?? "";
        const expectedDocIds = item.expectedDocIds ?? [];
        const citedDocIds = citedDocIdsOf(item);
        let verdict;
        try {
          verdict = await judge({
            question,
            answer,
            expectedDocIds,
            citedDocIds,
          });
        } catch (error) {
          verdict = {
            faithful: null,
            reason: `judge_error: ${error?.message ?? error}`,
          };
        }
        records[slot] = {
          id: item.id,
          kind: item.kind,
          question,
          expectedDocIds,
          citedDocIds,
          recorded: recordedVerdict(item),
          previous: previousVerdict(item),
          flipped: verdictFlipped(item),
          verdict,
        };
        onProgress?.(records[slot], slot + 1, selected.length);
      }
    },
  );
  await Promise.all(workers);
  return records;
}

function verdictLabel(value) {
  if (value === true) return "一致";
  if (value === false) return "不一致";
  return "判官失败";
}

function docList(list) {
  return Array.isArray(list) && list.length > 0 ? list.join(", ") : "—";
}

/** 渲染 citation-review.md。 */
export function renderCitationReview({
  records,
  runName = "未知运行",
  scope = "full",
  generatedAt = new Date().toISOString(),
  runMeta = {},
}) {
  const total = records.length;
  const flipped = records.filter((record) => {
    const before = record.recorded?.faithful;
    const after = record.verdict?.faithful;
    return (
      typeof before === "boolean" &&
      typeof after === "boolean" &&
      before !== after
    );
  }).length;
  const failed = records.filter(
    (record) => typeof record.verdict?.faithful !== "boolean",
  ).length;

  const lines = [
    "# 引用核验诊断（citation review）",
    "",
    `- 运行：${runName}`,
    `- 生成时间：${generatedAt}`,
    `- 抽样口径：${scope === "subset" ? "子集全查" : "全量抽样"}（${total} 条）`,
    `- 指标版本：metricSpecVersion=${METRIC_SPEC_VERSION}`,
    `- 判官输入规范：judgeSpecVersion=${runMeta.judgeSpecVersion ?? "未知"}`,
    "",
    "> 只做诊断：核验结果不改 `kbAccuracy`、不升 metric 版本、不写 run 记录。",
    "> 判官按 docId 拉**当前**文档分块，因此能发现「回答与当前文档不一致」",
    "> 或「引用漂移」，但不能证明文档内容符合业务真相（那是人工抽检的职责）。",
    "",
    "## 结果概览",
    "",
    `- 与记录判决相比翻转：${flipped}`,
    `- 判官失败：${failed}`,
    "",
    "| 用例 | 问题 | golden 文档 | 回答引用 | 记录判决 | 核验判决 | 说明 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const record of records) {
    const before = record.recorded?.faithful;
    const after = record.verdict?.faithful;
    const changed =
      typeof before === "boolean" &&
      typeof after === "boolean" &&
      before !== after;
    const note = changed
      ? `**判决翻转**：${record.recorded?.reason ?? ""} → ${record.verdict?.reason ?? ""}`
      : record.verdict?.reason ?? "";
    lines.push(
      `| ${record.id} | ${short(record.question, 80)} | ${docList(record.expectedDocIds)} | ${docList(record.citedDocIds)} | ${verdictLabel(before)} | ${verdictLabel(after)} | ${short(note, 240).replace(/\|/g, "\\|")} |`,
    );
  }

  const drift = records.filter(
    (record) =>
      (record.citedDocIds ?? []).some(
        (docId) => !(record.expectedDocIds ?? []).includes(docId),
      ),
  );
  if (drift.length > 0) {
    lines.push(
      "",
      "## 引用漂移（回答引用了 golden 之外的文档）",
      "",
      ...drift.map(
        (record) =>
          `- ${record.id}：引用 ${docList(record.citedDocIds)}；golden ${docList(record.expectedDocIds)}`,
      ),
    );
  }

  lines.push(
    "",
    "## 人工抽检记录",
    "",
    "- [ ] 上述样本是否覆盖本次变更文档：",
    "- [ ] 抽检结论（符合 / 需修文档 / 需补用例）：",
    "",
  );
  return lines.join("\n");
}

function loadDetail(inputPath) {
  const detail = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (!Array.isArray(detail?.cases)) {
    throw new Error(`${inputPath} 不是 E2E detail.json（缺少 cases 数组）`);
  }
  return detail;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseCitationArgs(argv);
  if (!args.input) {
    throw new Error(
      "用法：node tools/eval/e2e/verify-citations.mjs <detail.json> [--scope subset|full] [--limit 10] [--doc-ids a,b] [--out dir]",
    );
  }
  const detail = loadDetail(args.input);
  const runDir = path.dirname(path.resolve(args.input));
  const runName = path.basename(runDir);
  const outDir = path.resolve(
    args.out ?? path.join(runDir, "..", `${runName}-citation-review`),
  );
  const scope = args.scope ?? "full";

  const config = loadConfig();
  const admin = createAdminApi(config, {
    throttle: createThrottle({ perMinute: config.httpPerMinute }),
    logger: { warn: log, log, error: log },
  });

  log(`核验 ${scope} 运行 ${runName}（上限 ${scope === "subset" ? "全部" : args.limit}）`);
  const records = await runCitationReview({
    cases: detail.cases,
    admin,
    scope,
    limit: args.limit,
    docIds: args.docIds,
    concurrency: args.concurrency,
    onProgress: (record, index, total) =>
      log(`[${index}/${total}] ${record.id} → ${verdictLabel(record.verdict?.faithful)}`),
  });

  const markdown = renderCitationReview({
    records,
    runName,
    scope,
    runMeta: {
      ...detail.meta,
      judgeSpecVersion:
        detail.meta?.judgeSpecVersion ??
        records.find((record) => record.verdict?.judgeSpecVersion)?.verdict
          .judgeSpecVersion,
    },
  });
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "citation-review.md");
  fs.writeFileSync(outPath, markdown, { mode: 0o600 });
  log(`已写入 ${outPath}`);
  return { outPath, records };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    log(`失败：${error?.message ?? error}`);
    process.exitCode = 1;
  });
}
