import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_CONCURRENCY,
  chooseScenario,
  mapWithConcurrency,
  parseArgs,
  runSwarm,
} from "./run.mjs";

const quietLogger = { log() {}, warn() {}, error() {} };

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakeRunner(handler) {
  return async (account, scenario) => {
    await handler(account, scenario);
    return {
      conversationId: `conv-${account.userId}-${scenario.id}`,
      turnsSent: 1,
      replies: 1,
      confirms: 0,
      transferred: false,
      noReply: false,
      errors: [],
    };
  };
}

test("parseArgs 默认一次、并发交给 config", () => {
  assert.deepEqual(parseArgs([]), {
    once: false,
    rounds: 1,
    concurrency: null,
    scenario: null,
    help: false,
  });
});

test("parseArgs 接受 --once/--rounds/--concurrency/--scenario", () => {
  assert.deepEqual(parseArgs(["--once"]), {
    once: true,
    rounds: 1,
    concurrency: null,
    scenario: null,
    help: false,
  });

  assert.deepEqual(
    parseArgs([
      "--rounds",
      "6",
      "--concurrency",
      "5",
      "--scenario",
      "order_status",
    ]),
    {
      once: false,
      rounds: 6,
      concurrency: 5,
      scenario: "order_status",
      help: false,
    },
  );
});

test("parseArgs 拒绝非法并发、轮数、参数与 --once 冲突", () => {
  assert.throws(() => parseArgs(["--concurrency", "6"]), /concurrency/);
  assert.throws(() => parseArgs(["--concurrency", "0"]), /concurrency/);
  assert.throws(() => parseArgs(["--rounds", "0"]), /rounds/);
  assert.throws(() => parseArgs(["--rounds", "abc"]), /rounds/);
  assert.throws(() => parseArgs(["--rounds"]), /缺少参数值/);
  assert.throws(() => parseArgs(["--nope"]), /未知参数/);
  assert.throws(() => parseArgs(["--once", "--rounds", "2"]), /不能同时/);
  assert.equal(MAX_CONCURRENCY, 5);
});

test("mapWithConcurrency 限制同时运行数并保持结果顺序", async () => {
  let active = 0;
  let maxActive = 0;
  const items = [1, 2, 3, 4, 5, 6, 7];

  const results = await mapWithConcurrency(items, 3, async (item) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await delay(3);
    active -= 1;
    return item * 2;
  });

  assert.equal(maxActive, 3);
  assert.deepEqual(results, [2, 4, 6, 8, 10, 12, 14]);
});

test("mapWithConcurrency 在 shouldStop 后停止调度新任务", async () => {
  let completed = 0;

  const results = await mapWithConcurrency(
    Array.from({ length: 10 }, (_, index) => index),
    2,
    async () => {
      await delay(2);
      completed += 1;
      return true;
    },
    { shouldStop: () => completed >= 3 },
  );

  const started = results.filter(Boolean).length;
  assert.ok(started >= 3, `started=${started}`);
  assert.ok(started < 10, `started=${started}`);
});

test("chooseScenario 排除上一 intent 与场景 ID", () => {
  const scenario = chooseScenario({
    excludeIntents: ["order"],
    lastScenarioId: "order_status",
    rng: () => 0,
  });

  assert.notEqual(scenario.intent, "order");
  assert.notEqual(scenario.id, "order_status");
});

test("runSwarm 轮转账号、避开连续 intent、限制并发", async () => {
  const accounts = [{ userId: "u1" }, { userId: "u2" }];
  const intentsByAccount = new Map();
  let active = 0;
  let maxActive = 0;

  const runner = fakeRunner(async (account, scenario) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await delay(3);
    active -= 1;
    const list = intentsByAccount.get(account.userId) ?? [];
    list.push(scenario.intent);
    intentsByAccount.set(account.userId, list);
  });

  const results = await runSwarm({
    accounts,
    concurrency: 2,
    rounds: 2,
    runner,
    logger: quietLogger,
    rng: () => 0.05,
    config: { businessId: "simulation_support_v1" },
  });

  assert.equal(results.length, 4);
  assert.equal(maxActive, 2);
  assert.deepEqual(
    results.map((result) => result.index),
    [0, 1, 2, 3],
  );
  assert.deepEqual(
    results.map((result) => result.accountIndex),
    [0, 1, 0, 1],
  );

  for (const [userId, intents] of intentsByAccount) {
    for (let i = 1; i < intents.length; i += 1) {
      assert.notEqual(
        intents[i],
        intents[i - 1],
        `${userId} 连续两次 intent 相同：${intents.join(" -> ")}`,
      );
    }
  }
});

test("runSwarm 把单个会话异常计入结果而不中断整体", async () => {
  const accounts = [{ userId: "u1" }, { userId: "u2" }];

  const results = await runSwarm({
    accounts,
    concurrency: 2,
    rounds: 1,
    logger: quietLogger,
    rng: () => 0.05,
    config: { businessId: "simulation_support_v1" },
    runner: async (account, scenario) => {
      await delay(1);
      if (account.userId === "u2") {
        throw new Error("boom token=secret-token");
      }
      return {
        conversationId: `conv-${account.userId}-${scenario.id}`,
        turnsSent: 1,
        replies: 1,
        confirms: 0,
        transferred: false,
        noReply: false,
        errors: [],
      };
    },
  });

  assert.equal(results.length, 2);
  const failed = results.filter((result) => result.errors.length > 0);
  assert.equal(failed.length, 1);
  assert.match(failed[0].errors[0], /boom/);
  assert.doesNotMatch(failed[0].errors[0], /secret-token/);
  const succeeded = results.filter((result) => result.errors.length === 0);
  assert.equal(succeeded.length, 1);
  assert.ok(succeeded[0].conversationId);
});

test("runSwarm 收到 stop 后不再调度新会话", async () => {
  let completed = 0;

  const results = await runSwarm({
    accounts: [{ userId: "u1" }],
    concurrency: 1,
    rounds: 5,
    logger: quietLogger,
    rng: () => 0.05,
    config: { businessId: "simulation_support_v1" },
    shouldStop: () => completed >= 2,
    runner: fakeRunner(async () => {
      await delay(2);
      completed += 1;
    }),
  });

  assert.ok(completed >= 2);
  assert.ok(completed < 5, `completed=${completed}`);
  assert.equal(results.length, completed);
});

test("runSwarm 拒绝空账号池与非法并发", async () => {
  await assert.rejects(
    runSwarm({ accounts: [], concurrency: 1, rounds: 1 }),
    /账号池/,
  );
  await assert.rejects(
    runSwarm({ accounts: [{ userId: "u1" }], concurrency: 99, rounds: 1 }),
    /concurrency/,
  );
});
