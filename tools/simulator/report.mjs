/**
 * 并发运行报告（P0 / Task 5）。
 *
 * - `summarize(results)`：纯函数，按 intent 与特殊场景分类统计
 * - `writeReport(results, opts)`：把 summary.json 与 events.jsonl 写到
 *   `.runtime/runs/<ISO>/`
 *
 * 特殊场景（transfer / correction / injection / ambiguous / long）在场景库里
 * 都被标记为 `intent: "general"`；统计时把它们从 `byIntent` 拆出来单独计数，
 * 避免 general 覆盖数字被特殊场景稀释。
 *
 * 报告只包含场景、计数、错误摘要与时间戳；不写入 token / 手机号。
 */

import fs from "node:fs";
import path from "node:path";

import { INTENTS, SCENARIOS } from "./scenarios.mjs";

/** 场景库里出现过的特殊标签，预置为 0 便于观察覆盖。 */
export const SPECIAL_TAGS = Object.freeze([
  ...new Set(
    SCENARIOS.map((scenario) => scenario.special).filter((tag) => Boolean(tag)),
  ),
]);

function countOf(value) {
  return Number.isFinite(value) ? value : 0;
}

/**
 * 汇总一轮 swarm 的结果。
 *
 * `byIntent` 只统计普通场景；带 `special` 标签的结果进入 `special` 计数。
 * 所有 9 个 intent 与已知特殊标签都会预置为 0，方便对比覆盖缺口。
 *
 * @param {Array<{
 *   intent?: string,
 *   special?: string | null,
 *   turnsSent?: number,
 *   replies?: number,
 *   confirms?: number,
 *   transferred?: boolean,
 *   noReply?: boolean,
 *   errors?: string[],
 * }>} results
 * @returns {{
 *   conversations: number,
 *   turnsSent: number,
 *   replies: number,
 *   confirms: number,
 *   transfers: number,
 *   noReply: number,
 *   errors: number,
 *   byIntent: Record<string, number>,
 *   special: Record<string, number>,
 * }}
 */
export function summarize(results) {
  if (!Array.isArray(results)) {
    throw new TypeError("summarize: results 必须是数组");
  }

  const summary = {
    conversations: 0,
    turnsSent: 0,
    replies: 0,
    confirms: 0,
    transfers: 0,
    noReply: 0,
    errors: 0,
    byIntent: Object.fromEntries(INTENTS.map((intent) => [intent, 0])),
    special: Object.fromEntries(SPECIAL_TAGS.map((tag) => [tag, 0])),
  };

  for (const result of results) {
    if (!result || typeof result !== "object") {
      throw new TypeError("summarize: results 每一项必须是对象");
    }

    summary.conversations += 1;
    summary.turnsSent += countOf(result.turnsSent);
    summary.replies += countOf(result.replies);
    summary.confirms += countOf(result.confirms);
    if (result.transferred) summary.transfers += 1;
    if (result.noReply) summary.noReply += 1;
    if (Array.isArray(result.errors) && result.errors.length > 0) {
      summary.errors += 1;
    }

    if (result.special) {
      summary.special[result.special] =
        (summary.special[result.special] ?? 0) + 1;
    } else if (result.intent) {
      summary.byIntent[result.intent] =
        (summary.byIntent[result.intent] ?? 0) + 1;
    }
  }

  return summary;
}

/**
 * 把时间转成可安全用作目录名的 ISO 片段（冒号/点替换为短横线）。
 *
 * @param {Date} [date]
 * @returns {string}
 */
export function formatRunId(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError("formatRunId: 需要合法的 Date");
  }
  return date.toISOString().replace(/[:.]/g, "-");
}

/**
 * 写出一次运行的报告。
 *
 * 目录结构：
 *   .runtime/runs/<ISO>/summary.json   { generatedAt, summary }
 *   .runtime/runs/<ISO>/events.jsonl   每行一个会话结果
 *
 * @param {Array<object>} results
 * @param {{ runtimeDir: string, now?: Date, summary?: object }} options
 * @returns {{ dir: string, summaryPath: string, eventsPath: string, summary: object }}
 */
export function writeReport(results, options = {}) {
  const {
    runtimeDir,
    now = new Date(),
    summary = summarize(results),
  } = options;

  const baseDir = String(runtimeDir ?? "").trim();
  if (!baseDir) throw new Error("writeReport: runtimeDir 不能为空");

  const dir = path.join(baseDir, "runs", formatRunId(now));
  fs.mkdirSync(dir, { recursive: true });

  const summaryPath = path.join(dir, "summary.json");
  const eventsPath = path.join(dir, "events.jsonl");

  fs.writeFileSync(
    summaryPath,
    `${JSON.stringify({ generatedAt: now.toISOString(), summary }, null, 2)}\n`,
    { mode: 0o600 },
  );

  const lines = results.map((result) => JSON.stringify(result)).join("\n");
  fs.writeFileSync(eventsPath, lines ? `${lines}\n` : "", { mode: 0o600 });

  return { dir, summaryPath, eventsPath, summary };
}
