#!/usr/bin/env node
/**
 * 合成流量并发 runner（P0 / Task 5）。
 *
 * 账号池轮转 + 小并发 Promise 池 + 覆盖报告：
 *   node tools/simulator/run.mjs [--once] [--rounds N] [--concurrency N] [--scenario id]
 *
 * 行为：
 * - 每个任务取账号池中的下一个账号（轮转），并发上限 5
 * - 随机场景时排除该账号上一轮的 intent（`pickScenario` 的 excludeIntents），
 *   避免同一账号连续两次落在同一 intent
 * - 单个会话抛错只会写进该条结果，不会中断整个进程
 * - access token 在 401 时由 driver 刷新，runner 把新 token 写回内存池并
 *   通过 `onTokenRefresh` 持久化到 `accounts.json`
 * - SIGINT 只停止调度新会话；在途会话结束后写报告
 * - 报告写入 `.runtime/runs/<ISO>/summary.json` 与 `events.jsonl`
 *
 * 安全：报告与会话结果不含 token / 手机号；错误信息统一脱敏。
 */

import { pathToFileURL } from "node:url";

import { loadConfig } from "./config.mjs";
import { runConversation } from "./driver.mjs";
import { pickPersona } from "./humanize.mjs";
import { loadAccounts, redactSecrets, saveAccounts } from "./provision.mjs";
import { summarize, writeReport } from "./report.mjs";
import { SCENARIOS, pickScenario } from "./scenarios.mjs";

/** 与 config.mjs 的安全阀一致：P0 只允许 5 并发。 */
export const MAX_CONCURRENCY = 5;
const MAX_ROUNDS = 50;

function parseCliInt(flag, value, { min, max }) {
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`${flag} 需要整数，收到 "${text}"`);
  }
  const number = Number(text);
  if (number < min || number > max) {
    throw new Error(`${flag} 必须在 ${min}-${max} 之间，收到 ${number}`);
  }
  return number;
}

/**
 * 解析 CLI 参数。
 *
 * @param {string[]} argv
 * @returns {{ once: boolean, rounds: number, concurrency: number | null, scenario: string | null, help: boolean }}
 */
export function parseArgs(argv) {
  const options = {
    once: false,
    rounds: 1,
    concurrency: null,
    scenario: null,
    help: false,
  };
  let roundsExplicit = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const readValue = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} 缺少参数值`);
      return argv[i];
    };

    switch (arg) {
      case "--once":
        options.once = true;
        break;
      case "--rounds":
        options.rounds = parseCliInt(arg, readValue(), {
          min: 1,
          max: MAX_ROUNDS,
        });
        roundsExplicit = true;
        break;
      case "--concurrency":
        options.concurrency = parseCliInt(arg, readValue(), {
          min: 1,
          max: MAX_CONCURRENCY,
        });
        break;
      case "--scenario": {
        const value = String(readValue()).trim();
        if (!value) throw new Error("--scenario 不能为空");
        options.scenario = value;
        break;
      }
      case "-h":
      case "--help":
        options.help = true;
        break;
      default:
        throw new Error(`未知参数：${arg}（使用 --help 查看用法）`);
    }
  }

  if (options.once && roundsExplicit) {
    throw new Error("--once 与 --rounds 不能同时使用");
  }

  return options;
}

/**
 * 小并发 Promise 池（替代 p-limit，不新增依赖）。
 *
 * - 最多 `limit` 个 worker 同时运行
 * - 返回数组与输入顺序一致；未启动的位置保留空位（hole）
 * - `shouldStop()` 为 true 后不再调度新任务，但会等在途任务结束
 * - 任一 worker 抛错时记录首个错误，停止调度，等在途任务结束后 reject
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} worker
 * @param {{ shouldStop?: () => boolean }} [options]
 * @returns {Promise<R[]>}
 */
export async function mapWithConcurrency(items, limit, worker, options = {}) {
  if (!Array.isArray(items)) {
    throw new TypeError("mapWithConcurrency: items 必须是数组");
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("mapWithConcurrency: concurrency 必须是正整数");
  }
  if (typeof worker !== "function") {
    throw new TypeError("mapWithConcurrency: worker 必须是函数");
  }
  const shouldStop = options.shouldStop ?? (() => false);

  const results = new Array(items.length);
  let nextIndex = 0;
  let active = 0;
  let firstError = null;

  return new Promise((resolve, reject) => {
    const finishIfIdle = () => {
      if (active > 0) return;
      // active=0 但还有任务可调度时不能提前 resolve（例如 concurrency=1）。
      if (nextIndex < items.length && !firstError && !shouldStop()) return;
      if (firstError) reject(firstError);
      else resolve(results);
    };

    const launch = () => {
      while (
        !firstError &&
        active < limit &&
        nextIndex < items.length &&
        !shouldStop()
      ) {
        const index = nextIndex;
        nextIndex += 1;
        active += 1;

        Promise.resolve()
          .then(() => worker(items[index], index))
          .then(
            (value) => {
              results[index] = value;
            },
            (error) => {
              if (!firstError) firstError = error;
            },
          )
          .finally(() => {
            active -= 1;
            launch();
          });
      }

      finishIfIdle();
    };

    launch();
  });
}

/**
 * 选一个场景；随机时把该账号上一轮的 intent 与场景 ID 排除掉。
 *
 * 全量场景库走 `pickScenario` 的加权随机（特殊场景权重低）；传入子集时
 * 先按 pickScenario 抽样，命中子集才返回，否则回退到子集内均匀随机。
 *
 * @param {{
 *   scenarioId?: string | null,
 *   pool?: typeof SCENARIOS,
 *   excludeIntents?: string[],
 *   lastScenarioId?: string | null,
 *   rng?: () => number,
 * }} [options]
 * @returns {import("./scenarios.mjs").Scenario}
 */
export function chooseScenario(options = {}) {
  const {
    scenarioId = null,
    pool = SCENARIOS,
    excludeIntents = [],
    lastScenarioId = null,
    rng = Math.random,
  } = options;

  const scenarios = Array.isArray(pool) && pool.length > 0 ? pool : SCENARIOS;

  if (scenarioId) {
    const selected = scenarios.find((scenario) => scenario.id === scenarioId);
    if (!selected) throw new Error(`未知场景：${scenarioId}`);
    return selected;
  }

  const excluded = new Set(excludeIntents);
  const candidates = scenarios.filter(
    (scenario) => !excluded.has(scenario.intent),
  );
  const usable = candidates.length > 0 ? candidates : scenarios;
  const withoutLast = lastScenarioId
    ? usable.filter((scenario) => scenario.id !== lastScenarioId)
    : usable;
  const finalPool = withoutLast.length > 0 ? withoutLast : usable;

  if (finalPool.length === 1) return finalPool[0];

  for (let attempt = 0; attempt < 8; attempt += 1) {
    let candidate;
    try {
      candidate = pickScenario({
        excludeIntents: [...excluded],
        lastScenarioId,
        rng,
      });
    } catch {
      break;
    }
    if (finalPool.some((scenario) => scenario.id === candidate.id)) {
      return candidate;
    }
  }

  const index = Math.min(
    finalPool.length - 1,
    Math.floor(rng() * finalPool.length),
  );
  return finalPool[index];
}

function emptyOutcome() {
  return {
    conversationId: null,
    turnsSent: 0,
    replies: 0,
    confirms: 0,
    transferred: false,
    noReply: false,
    errors: [],
  };
}

/**
 * 跑一轮并发合成流量。
 *
 * 总任务数 = `rounds * concurrency`；`concurrency` 同时也是同时运行上限。
 *
 * @param {{
 *   accounts: Array<object>,
 *   scenarios?: typeof SCENARIOS,
 *   concurrency: number,
 *   rounds?: number,
 *   scenarioId?: string | null,
 *   config?: ReturnType<typeof loadConfig>,
 *   rng?: () => number,
 *   logger?: Pick<Console, "log" | "warn" | "error">,
 *   onTokenRefresh?: (account: object) => void | Promise<void>,
 *   runner?: typeof runConversation,
 *   shouldStop?: () => boolean,
 *   now?: () => Date,
 * }} options
 * @returns {Promise<Array<object>>} RunResult[]
 */
export async function runSwarm(options = {}) {
  const {
    accounts,
    scenarios = SCENARIOS,
    concurrency,
    rounds = 1,
    scenarioId = null,
    config = loadConfig(),
    rng = Math.random,
    logger = console,
    onTokenRefresh = null,
    runner = runConversation,
    shouldStop = () => false,
    now = () => new Date(),
  } = options;

  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("runSwarm: 账号池为空，请先运行 provision.mjs");
  }
  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > MAX_CONCURRENCY
  ) {
    throw new Error(
      `runSwarm: concurrency 必须在 1-${MAX_CONCURRENCY} 之间，收到 ${concurrency}`,
    );
  }
  if (!Number.isInteger(rounds) || rounds < 1) {
    throw new Error(`runSwarm: rounds 必须是正整数，收到 ${rounds}`);
  }
  if (scenarioId && !scenarios.some((scenario) => scenario.id === scenarioId)) {
    throw new Error(`runSwarm: 未知场景 ${scenarioId}`);
  }

  // 复制账号池：刷新 token 只影响本次运行的后续任务，不改调用方对象。
  const pool = accounts.map((account) => ({ ...account }));
  let accountCursor = 0;
  const lastByAccount = new Map();

  const persistRefreshed = (next) => {
    const index = pool.findIndex((account) => account.userId === next.userId);
    if (index >= 0) {
      pool[index] = {
        ...pool[index],
        token: next.token ?? pool[index].token,
        refreshToken: next.refreshToken ?? pool[index].refreshToken,
      };
    }
    onTokenRefresh?.(next);
  };

  const total = rounds * concurrency;
  const jobs = Array.from({ length: total }, (_, index) => index);

  const results = await mapWithConcurrency(
    jobs,
    concurrency,
    async (jobIndex) => {
      // mapWithConcurrency 已检查过；这里兜底，避免 stop 后仍分配账号。
      if (shouldStop()) return null;

      const accountIndex = accountCursor % pool.length;
      accountCursor += 1;
      const account = pool[accountIndex];

      const previous = lastByAccount.get(account.userId) ?? {};
      const scenario = chooseScenario({
        scenarioId,
        pool: scenarios,
        excludeIntents: previous.intent ? [previous.intent] : [],
        lastScenarioId: previous.id ?? null,
        rng,
      });
      lastByAccount.set(account.userId, {
        intent: scenario.intent,
        id: scenario.id,
      });

      const startedAt = now();
      let outcome;
      try {
        outcome = await runner(account, scenario, {
          config,
          rng,
          persona: pickPersona(rng),
          logger,
          onTokenRefresh: persistRefreshed,
        });
      } catch (error) {
        outcome = {
          ...emptyOutcome(),
          errors: [redactSecrets(error?.message ?? String(error))],
        };
      }
      const finishedAt = now();

      const result = {
        index: jobIndex,
        accountIndex,
        scenarioId: scenario.id,
        intent: scenario.intent,
        special: scenario.special ?? null,
        conversationId: outcome.conversationId ?? null,
        turnsSent: outcome.turnsSent ?? 0,
        replies: outcome.replies ?? 0,
        confirms: outcome.confirms ?? 0,
        transferred: Boolean(outcome.transferred),
        noReply: Boolean(outcome.noReply),
        errors: Array.isArray(outcome.errors) ? outcome.errors : [],
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      };

      logger.log?.(
        `[run] #${jobIndex} account#${accountIndex} ${scenario.id}` +
          ` intent=${scenario.intent} replies=${result.replies}` +
          ` confirms=${result.confirms}` +
          `${result.transferred ? " transferred" : ""}` +
          `${result.noReply ? " noReply" : ""}` +
          `${result.errors.length ? ` errors=${result.errors.length}` : ""}`,
      );

      return result;
    },
    { shouldStop },
  );

  return results.filter((result) => result !== null && result !== undefined);
}

function printUsage(write = console.log) {
  write(`用法：node tools/simulator/run.mjs [--once] [--rounds N] [--concurrency N] [--scenario id]

并发运行合成 AI 客服流量；默认跑 1 轮、并发取 SIM_CONCURRENCY（上限 5）。

选项：
  --once                  只跑 1 轮（不能与 --rounds 同时使用）
  --rounds <n>            轮数（1-${MAX_ROUNDS}），总任务数 = rounds * concurrency
  --concurrency <n>       并发（1-${MAX_CONCURRENCY}），默认 SIM_CONCURRENCY
  --scenario <id>         固定场景 ID（默认按 intent 随机并避开上一轮 intent）
  -h, --help              显示本帮助

环境变量：
  SIM_API_BASE_URL        API 根地址，默认 https://api.joyminis.com/api
  SIM_SOCKET_URL          Socket 地址，默认 https://api.joyminis.com/events
  SIM_BUSINESS_ID         渠道 ID，默认 simulation_support_v1
  SIM_RUNTIME_DIR         运行态目录，默认 tools/simulator/.runtime

报告：\${runtimeDir}/runs/<ISO>/summary.json 与 events.jsonl
安全：收到 ai_confirm / ai_transfer 立即停止；从不调用 /confirm 接口。
`);
}

/**
 * CLI 入口。
 *
 * @param {string[]} [argv]
 * @param {{
 *   logger?: Pick<Console, "log" | "warn" | "error">,
 *   config?: ReturnType<typeof loadConfig>,
 *   accounts?: Array<object>,
 *   rng?: () => number,
 *   runner?: typeof runConversation,
 *   saveAccounts?: typeof saveAccounts,
 *   handleSignals?: boolean,
 * }} [deps]
 * @returns {Promise<number>} 退出码
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const logger = deps.logger ?? console;
  const config = deps.config ?? loadConfig();

  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    logger.error(redactSecrets(error?.message ?? String(error)));
    return 1;
  }

  if (options.help) {
    printUsage(logger.log.bind(logger));
    return 0;
  }

  const accounts = deps.accounts ?? loadAccounts(config.runtimeDir);
  if (!Array.isArray(accounts) || accounts.length === 0) {
    logger.error(
      `账号池为空：${config.runtimeDir}/accounts.json 不存在或没有账号。`,
    );
    logger.error(
      "请先运行 node tools/simulator/provision.mjs（会按 5 个/批建号）。",
    );
    return 1;
  }

  const concurrency = options.concurrency ?? config.concurrency;

  let interrupted = false;
  const onSigint = () => {
    if (interrupted) {
      logger.warn?.("再次收到 SIGINT，强制退出。");
      process.exit(130);
    }
    interrupted = true;
    logger.warn?.(
      "收到 SIGINT：停止调度新会话，等待在途会话结束（再次 Ctrl+C 强制退出）",
    );
  };
  if (deps.handleSignals !== false) process.on("SIGINT", onSigint);

  // 刷新后的 token 写回本地文件，后续运行不必重新建号。
  const accountList = accounts.map((account) => ({ ...account }));
  const persist = (next) => {
    const index = accountList.findIndex(
      (account) => account.userId === next.userId,
    );
    if (index >= 0) {
      accountList[index] = {
        ...accountList[index],
        token: next.token ?? accountList[index].token,
        refreshToken: next.refreshToken ?? accountList[index].refreshToken,
      };
    }
    (deps.saveAccounts ?? saveAccounts)(config.runtimeDir, accountList);
  };

  const startedAt = new Date();

  try {
    const results = await runSwarm({
      accounts: accountList,
      concurrency,
      rounds: options.rounds,
      scenarioId: options.scenario,
      config,
      logger,
      rng: deps.rng,
      runner: deps.runner,
      onTokenRefresh: persist,
      shouldStop: () => interrupted,
    });

    const written = writeReport(results, {
      runtimeDir: config.runtimeDir,
      now: startedAt,
    });
    const summary = written.summary ?? summarize(results);

    logger.log?.(`\n[run] 完成 ${summary.conversations} 个会话`);
    logger.log?.(JSON.stringify(summary, null, 2));
    logger.log?.(`[run] 报告：${written.dir}`);

    return interrupted ? 130 : summary.conversations > 0 ? 0 : 1;
  } finally {
    if (deps.handleSignals !== false) {
      process.removeListener("SIGINT", onSigint);
    }
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main()
    .then((code) => {
      process.exitCode = code ?? 0;
    })
    .catch((error) => {
      console.error(redactSecrets(error?.message ?? String(error)));
      process.exitCode = 1;
    });
}
