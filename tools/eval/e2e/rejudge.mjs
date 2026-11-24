#!/usr/bin/env node
/**
 * 离线重判：不重跑用例，只把已有回答重新判一遍。
 *
 *   node tools/eval/e2e/rejudge.mjs tools/eval/e2e/reports/<run>/detail.json \
 *     [--out reports/<run>-rejudged] [--concurrency 3] [--limit N] [--include-cited]
 *
 * `--include-cited` 额外跑一遍「放宽口径」：判 B 时把回答实际引用、但 golden
 * 未列出的文档也交给判官，用来区分「回答编造」与「golden 文档集不全」。
 * 严格口径（只给 golden）保持不变，报告同时列两套数字。
 *
 * 做三件事：
 *   1. 用 `ai_traces` / `ai_spans` 判清每条回答的依据来源
 *      （兜底 > 工具 > 知识库 > 无依据）；
 *   2. 只对「知识库依据」组重新调 `/admin/rag/documents/judge`，
 *      只传 docId，由端点按 JudgeInputSpec 取 chunk、挑来源并脱敏；
 *   3. 输出新旧对照（校准）：来源未变的对照组一致率、翻真/翻假清单。
 *
 * 旧判定原样保留在 `case.judge`，新判定写到 `case.rejudge`，报告同时渲染两套。
 * 只读 DB、只读用例文件；唯一的写操作是把报告写到 --out 目录。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAdminApi, readBackendEnv } from "./admin.mjs";
import { loadConfig } from "./config.mjs";
import { classifyJudgeError } from "./external-sync.mjs";
import { createThrottle } from "./http.mjs";
import { cannedReplyCheck, fingerprint, judgeGoldenAgreement } from "./judge.mjs";
import { METRIC_SPEC_VERSION } from "./metrics-spec.mjs";
import { rate, writeReport } from "./report.mjs";
import { applyGrounding, collectMessageIds, loadGrounding } from "./traces.mjs";

const log = (message) => process.stderr.write(`[rejudge] ${message}\n`);

export function parseRejudgeArgs(argv = []) {
  const args = {
    input: null,
    out: null,
    concurrency: 3,
    limit: 0,
    includeCited: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--out") args.out = argv[++index];
    else if (token === "--concurrency") args.concurrency = Number(argv[++index]) || 3;
    else if (token === "--limit") args.limit = Number(argv[++index]) || 0;
    else if (token === "--include-cited") args.includeCited = true;
    else if (!token.startsWith("-") && !args.input) args.input = token;
  }
  return args;
}

export function loadDetail(inputPath) {
  const detail = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (!Array.isArray(detail?.cases)) {
    throw new Error(`${inputPath} 不是 E2E detail.json（缺少 cases 数组）`);
  }
  return detail;
}

/** 保留旧判定，另存 V1 → 后续写 `judge.goldenAgreementV1`。 */
export function stashV1(cases) {
  return cases.map((item) => {
    if (!item?.judge || !("goldenAgreement" in item.judge)) return item;
    return {
      ...item,
      judge: {
        ...item.judge,
        goldenAgreementV1: item.judge.goldenAgreement ?? null,
      },
    };
  });
}

/**
 * 判官失败补 `errorKind`。
 *
 * 服务端已返回结构化 `errorKind`；只有网络/端点异常走到 harness 的 catch
 * 分支时，才需要按 reason 归类，否则判官错误分布里会多出一堆 `unknown`。
 * 非失败判定（有布尔结果 / 不适用）原样返回。
 */
export function annotateJudgeError(judge) {
  if (!judge) return judge;
  if (judge.faithful !== null && judge.faithful !== undefined) return judge;
  if (judge.errorKind) return judge;
  const reason = String(judge.reason ?? "");
  if (!/^judge_error\b/.test(reason)) return judge;
  return { ...judge, errorKind: classifyJudgeError(reason) };
}

/** 需要重新判 B 的用例：知识库依据、非兜底、有 golden 文档、有真实回答。 */
export function selectRejudgeCases(cases) {
  return (cases ?? []).filter((item) => {
    if (item.status !== "ok") return false;
    if (item.kind !== "knowledge" && item.kind !== "multi") return false;
    if (item.judge?.grounding?.kind !== "kb") return false;
    if ((item.expectedDocIds ?? []).length === 0) return false;
    const last = item.rounds?.[item.rounds.length - 1];
    const content = String(last?.reply?.content ?? "");
    return content.length > 0 && !cannedReplyCheck(content).canned;
  });
}

/**
 * 新旧对照。
 *
 * 对照组：单文档、chunk 总数 ≤ 8 —— 旧实现（前 8 个 chunk）其实已经取全，
 * sources 集合不变，两版判决应当一致；不一致说明判官本身不稳定。
 */
export function buildCalibration(cases, chunkTotals = new Map()) {
  const compared = (cases ?? []).filter(
    (item) =>
      item.rejudge?.goldenAgreement?.faithful !== null &&
      item.rejudge?.goldenAgreement?.faithful !== undefined &&
      item.judge?.goldenAgreementV1?.faithful !== null &&
      item.judge?.goldenAgreementV1?.faithful !== undefined,
  );
  const isSame = (item) =>
    item.judge.goldenAgreementV1.faithful ===
    item.rejudge.goldenAgreement.faithful;
  const control = compared.filter((item) => {
    const docs = item.expectedDocIds ?? [];
    if (docs.length !== 1) return false;
    const total = chunkTotals.get(docs[0]);
    return Number.isFinite(total) && total <= 8;
  });

  const row = (item) => ({
    id: item.id,
    question: item.rounds?.[item.rounds.length - 1]?.question ?? "",
    v1: item.judge.goldenAgreementV1.faithful,
    v2: item.rejudge.goldenAgreement.faithful,
    v2Reason: item.rejudge.goldenAgreement.reason ?? "",
    unsupportedClaims: item.rejudge.goldenAgreement.unsupportedClaims ?? [],
  });

  return {
    compared: compared.length,
    agreement: rate(compared.filter(isSame).length, compared.length),
    control: {
      total: control.length,
      agree: control.filter(isSame).length,
      disagree: control.filter((item) => !isSame(item)).map(row),
    },
    flippedToFaithful: compared
      .filter(
        (item) =>
          item.judge.goldenAgreementV1.faithful === false &&
          item.rejudge.goldenAgreement.faithful === true,
      )
      .map(row),
    flippedToUnfaithful: compared
      .filter(
        (item) =>
          item.judge.goldenAgreementV1.faithful === true &&
          item.rejudge.goldenAgreement.faithful === false,
      )
      .map(row),
  };
}

// ── 主流程 ────────────────────────────────────────────────────────────

export async function main(env = process.env, argv = process.argv.slice(2)) {
  const args = parseRejudgeArgs(argv);
  if (!args.input) {
    throw new Error(
      "用法：node tools/eval/e2e/rejudge.mjs <detail.json> [--out DIR] [--concurrency 3] [--limit N]",
    );
  }

  const detail = loadDetail(args.input);
  const config = loadConfig(env);
  // 判官输入规范由后端环境决定（默认 v2）；报告记录实际口径，便于两次
  // 重判之间确认用的是同一版本。
  const judgeSpecVersion =
    readBackendEnv("JUDGE_INPUT_SPEC_VERSION") === "v1" ? "v1" : "v2";
  // 与实时运行共用同一套节流：后端全局限流是 60 次/分/IP
  const stats = { requests: 0, throttled: 0, retries: 0 };
  const admin = createAdminApi(config, {
    logger: { log, warn: log, error: log },
    throttle: createThrottle({ perMinute: config.httpPerMinute }),
    stats,
  });

  let cases = stashV1(detail.cases);
  const grounding = loadGrounding({ messageIds: collectMessageIds(cases) });
  log(`traces 关联：${grounding.size} 条回答`);
  cases = applyGrounding(cases, grounding);

  const counts = {};
  for (const item of cases) {
    const kind =
      item.judge?.grounding?.kind ?? (item.kind === "knowledge" ? "unknown" : "—");
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  log(
    `依据来源分布：${Object.entries(counts)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ")}`,
  );

  const targets = selectRejudgeCases(cases).slice(
    0,
    args.limit > 0 ? args.limit : undefined,
  );
  log(`重判 ${targets.length} 条（知识库依据组）`);

  // chunk 总数：对照组的「旧实现是否已取全」靠它判断
  const chunkTotals = new Map();
  const docs = new Set(targets.flatMap((item) => item.expectedDocIds ?? []));
  for (const docId of docs) {
    const chunks = await admin.getChunksByDocId(docId).catch(() => []);
    chunkTotals.set(docId, Array.isArray(chunks) ? chunks.length : 0);
  }

  let done = 0;
  const queue = [...targets];
  const worker = async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      const last = item.rounds?.[item.rounds.length - 1];
      const question = last?.question ?? "";
      const answer = last?.reply?.content ?? "";
      const goldenAgreement = annotateJudgeError(
        await judgeGoldenAgreement({
          admin,
          question,
          answer,
          expectedDocIds: item.expectedDocIds,
        }),
      );
      // 放宽口径：把回答实际引用、但 golden 没列出的文档也交给判官。
      // 只做诊断，不覆盖严格口径；用于区分「回答编造」与「golden 集不全」。
      let expandedAgreement = null;
      if (args.includeCited) {
        const expected = new Set(item.expectedDocIds ?? []);
        const extraDocIds = [
          ...new Set(
            (last?.reply?.sources ?? [])
              .map((source) => source?.docId)
              .filter((docId) => docId && !expected.has(docId)),
          ),
        ];
        if (extraDocIds.length > 0) {
          expandedAgreement = annotateJudgeError(
            await judgeGoldenAgreement({
              admin,
              question,
              answer,
              expectedDocIds: item.expectedDocIds,
              extraDocIds,
            }),
          );
        }
      }
      item.rejudge = {
        version: "v2",
        basis: "kb",
        applicable: true,
        evidence: item.judge.grounding,
        goldenAgreement,
        ...(expandedAgreement ? { expandedAgreement } : {}),
      };
      done += 1;
      if (done % 20 === 0) log(`进度 ${done}/${targets.length}`);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(args.concurrency, Math.max(targets.length, 1)) },
      worker,
    ),
  );

  // 非 kb 组也写一份 rejudge 记录（不适用判 B，但保留依据来源供报告分组）
  for (const item of cases) {
    if (item.rejudge || !item.judge?.grounding) continue;
    item.rejudge = {
      version: "v2",
      basis: item.judge.grounding.kind,
      applicable: item.judge.grounding.kind === "kb",
      evidence: item.judge.grounding,
      goldenAgreement: annotateJudgeError(item.judge.goldenAgreement ?? null),
    };
  }

  const calibration = buildCalibration(cases, chunkTotals);
  const runDir = path.dirname(path.resolve(args.input));
  const out =
    args.out ?? path.join(path.dirname(runDir), `${path.basename(runDir)}-rejudged`);
  const result = {
    meta: {
      ...detail.meta,
      rejudge: {
        at: new Date().toISOString(),
        input: args.input,
        rejudgedCases: targets.length,
        includeCited: args.includeCited,
        judgeSpecVersion,
        metricSpecVersion: String(METRIC_SPEC_VERSION),
        fingerprint: fingerprint(cases.map((item) => item.id)),
        judgeModel:
          cases.find((item) => item.judge?.taskJudge?.judgeModel)?.judge
            .taskJudge.judgeModel ?? null,
      },
    },
    fixtures: detail.fixtures,
    stats: detail.stats,
    calibration,
    cases,
  };
  writeReport(result, out);
  log(`报告已写入 ${out}/summary.md`);
  log(
    `校准：对照组 ${calibration.control.agree}/${calibration.control.total} 一致；` +
      `翻真 ${calibration.flippedToFaithful.length}，翻假 ${calibration.flippedToUnfaithful.length}`,
  );
  return { out, calibration };
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((error) => {
    log(`失败：${error?.stack ?? error}`);
    process.exitCode = 1;
  });
}
