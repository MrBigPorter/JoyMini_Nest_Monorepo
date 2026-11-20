import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { formatRunId, summarize, writeReport } from "./report.mjs";
import { INTENTS } from "./scenarios.mjs";

test("summarize 统计 intent 与异常", () => {
  const summary = summarize([
    {
      intent: "order",
      replies: 2,
      confirms: 0,
      transferred: false,
      noReply: false,
      turnsSent: 2,
    },
  ]);

  assert.equal(summary.conversations, 1);
  assert.equal(summary.replies, 2);
  assert.equal(summary.turnsSent, 2);
  assert.equal(summary.byIntent.order, 1);
  assert.equal(summary.transfers, 0);
  assert.equal(summary.noReply, 0);
});

test("summarize 把所有 9 个 intent 预置为 0", () => {
  const summary = summarize([]);

  assert.equal(summary.conversations, 0);
  for (const intent of INTENTS) {
    assert.equal(summary.byIntent[intent], 0, `byIntent.${intent}`);
  }
});

test("summarize 把特殊场景从 byIntent 中拆出来单独计数", () => {
  const summary = summarize([
    {
      intent: "general",
      scenarioId: "general_greeting",
      special: null,
      replies: 1,
      turnsSent: 1,
    },
    {
      intent: "general",
      scenarioId: "special_transfer",
      special: "transfer",
      replies: 1,
      turnsSent: 1,
      transferred: true,
    },
    {
      intent: "general",
      scenarioId: "special_injection",
      special: "injection",
      replies: 2,
      turnsSent: 2,
    },
    {
      intent: "order",
      scenarioId: "order_status",
      special: null,
      replies: 0,
      turnsSent: 1,
      noReply: true,
      errors: ["send_message ack 超时"],
    },
  ]);

  assert.equal(summary.conversations, 4);
  // 特殊场景 intent 都是 general，不应污染 byIntent.general。
  assert.equal(summary.byIntent.general, 1);
  assert.equal(summary.byIntent.order, 1);
  assert.equal(summary.special.transfer, 1);
  assert.equal(summary.special.injection, 1);
  assert.equal(summary.special.correction, 0);
  // transferred 仍是观测到的事实，特殊场景也计入。
  assert.equal(summary.transfers, 1);
  assert.equal(summary.noReply, 1);
  assert.equal(summary.errors, 1);
});

test("summarize 拒绝非数组输入", () => {
  assert.throws(() => summarize(null), /数组/);
  assert.throws(() => summarize("nope"), /数组/);
});

test("formatRunId 生成可安全用作目录名的时间戳", () => {
  const id = formatRunId(new Date("2026-11-20T16:58:00.123Z"));

  assert.match(id, /^[0-9TZ-]+$/);
  assert.equal(id, "2026-11-20T16-58-00-123Z");
});

test("writeReport 写出 summary.json 与 events.jsonl", () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "sim-report-test-"));
  try {
    const results = [
      {
        index: 0,
        accountIndex: 0,
        scenarioId: "order_status",
        intent: "order",
        special: null,
        conversationId: "conv-1",
        turnsSent: 2,
        replies: 2,
        confirms: 0,
        transferred: false,
        noReply: false,
        errors: [],
        startedAt: "2026-11-20T16:58:00.000Z",
        finishedAt: "2026-11-20T16:58:10.000Z",
        durationMs: 10_000,
      },
      {
        index: 1,
        accountIndex: 1,
        scenarioId: "special_transfer",
        intent: "general",
        special: "transfer",
        conversationId: "conv-2",
        turnsSent: 1,
        replies: 1,
        confirms: 0,
        transferred: true,
        noReply: false,
        errors: [],
        startedAt: "2026-11-20T16:58:00.000Z",
        finishedAt: "2026-11-20T16:58:05.000Z",
        durationMs: 5_000,
      },
    ];

    const written = writeReport(results, {
      runtimeDir,
      now: new Date("2026-11-20T17:00:00.000Z"),
    });

    assert.equal(
      written.dir,
      path.join(runtimeDir, "runs", "2026-11-20T17-00-00-000Z"),
    );

    const summary = JSON.parse(fs.readFileSync(written.summaryPath, "utf8"));
    assert.equal(summary.generatedAt, "2026-11-20T17:00:00.000Z");
    assert.equal(summary.summary.conversations, 2);
    assert.equal(summary.summary.byIntent.order, 1);
    assert.equal(summary.summary.byIntent.general, 0);
    assert.equal(summary.summary.special.transfer, 1);

    const lines = fs
      .readFileSync(written.eventsPath, "utf8")
      .trim()
      .split("\n");
    assert.equal(lines.length, 2);
    const events = lines.map((line) => JSON.parse(line));
    assert.deepEqual(
      events.map((event) => event.scenarioId),
      ["order_status", "special_transfer"],
    );
  } finally {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }
});
