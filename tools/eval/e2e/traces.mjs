/**
 * 把每条回答关联回后端的观测数据（`ai_traces` + `ai_spans`），回答一个问题：
 * **这条回答是靠什么生成的**？
 *
 *   kb   —— 检索到了知识库（ragSourceCount > 0，或回答自带 sources）
 *   tool —— 至少调用了一个工具（余额、订单、KYC、商品…）
 *   none —— 既没检索也没调工具
 *
 * 只读查询（psql -tAc），不写库；不做任何业务数据改动。
 * 查询逻辑与解析逻辑拆开，解析部分是纯函数，单测覆盖。
 */
import { DEFAULT_DB_CONTAINER, DEFAULT_DB_NAME, queryDbRows } from "./admin.mjs";
import { cannedReplyCheck, classifyGrounding } from "./judge.mjs";

/** 运行时落库的依据分型取值（`ai_traces.metadata.grounding`）。 */
const GROUNDING_KINDS = new Set(["kb", "tool", "none", "fallback"]);

/** 只允许 cuid 形态的 id 进 SQL（防止拼接注入）。 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function groundingSql(messageIds) {
  const ids = [...new Set((messageIds ?? []).filter((id) => SAFE_ID.test(id)))];
  if (ids.length === 0) return null;
  const list = ids.map((id) => `'${id}'`).join(",");
  return [
    "select t.ai_message_id,",
    "       coalesce(t.intent, ''),",
    "       coalesce(t.metadata->>'flow', ''),",
    "       case when (t.metadata->>'ragSourceCount') ~ '^[0-9]+$'",
    "            then (t.metadata->>'ragSourceCount')::int else 0 end,",
    "       coalesce(string_agg(distinct s.name, ',') filter (where s.type = 'tool'), ''),",
    "       coalesce(t.metadata->>'grounding', ''),",
    "       coalesce(t.metadata->'groundingGate'->>'mode', ''),",
    "       coalesce(t.metadata->'groundingGate'->>'decision', '')",
    "from ai_traces t",
    "left join ai_spans s on s.trace_id = t.id",
    `where t.ai_message_id in (${list})`,
    "group by t.ai_message_id, t.intent, t.metadata",
  ].join("\n");
}

/** 解析 `psql -tA` 的 `|` 分隔输出（跳过 SET 之类的命令行标记）。 */
export function parseGroundingRows(stdout) {
  const map = new Map();
  for (const line of String(stdout ?? "").split("\n")) {
    const parts = line.split("|");
    if (parts.length < 4) continue;
    const [
      messageId,
      intent,
      flow,
      ragSourceCount,
      tools,
      grounding,
      gateMode,
      gateDecision,
    ] = parts;
    map.set(messageId, {
      intent: intent || null,
      flow: flow || null,
      ragSourceCount: Number(ragSourceCount) || 0,
      tools: (tools || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      // 线上 trace 已直接落依据分型时优先用它；空串表示旧版本没写。
      grounding: grounding || null,
      // 发布门禁决定（shadow 阶段只记录、不改回复）
      groundingGate:
        gateMode && gateDecision
          ? { mode: gateMode, decision: gateDecision }
          : null,
    });
  }
  return map;
}

/**
 * 批量读 grounding。一个查询覆盖整次运行（按回答消息 id）。
 * `query` 可注入，方便单测；默认走只读 psql。
 */
export function loadGrounding({
  messageIds,
  dbContainer = process.env.E2E_DB_CONTAINER || DEFAULT_DB_CONTAINER,
  dbName = process.env.E2E_DB_NAME || DEFAULT_DB_NAME,
  query = queryDbRows,
} = {}) {
  const sql = groundingSql(messageIds);
  if (!sql) return new Map();
  return parseGroundingRows(query(sql, { dbContainer, dbName }));
}

/** 一条用例最后一轮回答的消息 id（多轮取最后一轮，与判定口径一致）。 */
export function lastReplyMessageId(testCase) {
  const rounds = testCase?.rounds ?? [];
  return rounds[rounds.length - 1]?.reply?.messageId ?? null;
}

/**
 * 给用例补上 `grounding`，并按依据来源修正 `goldenAgreement` 是否可判。
 *
 * 纯函数：返回新数组，不改入参。分类优先级 **fallback > tool > kb > none**
 * （有兜底话术的轮次即使调过工具，也不是回答，不能算进任何准确率分母）。
 *
 *   kb       → 保持判定（可计入准确率分母）
 *   tool     → applicable=false（工具数据不在知识库里，判 B 无意义）
 *   none     → applicable=false（无依据作答，单列为风险指标）
 *   fallback → applicable=false，且 answered=false（兜底不是回答）
 */
export function applyGrounding(cases, groundingByMessageId) {
  return (cases ?? []).map((item) => {
    // 只有知识/多轮这类做了 golden 判定的用例才需要标依据来源
    if (!item?.judge || !("goldenAgreement" in item.judge)) return item;
    const messageId = lastReplyMessageId(item);
    const trace = messageId ? groundingByMessageId?.get(messageId) : null;
    if (!trace) return item;

    const last = item.rounds?.at(-1);
    const content = String(last?.reply?.content ?? "");
    const canned = cannedReplyCheck(content);
    const cited = (last?.reply?.sources ?? []).length > 0;
    const declared = GROUNDING_KINDS.has(trace.grounding) ? trace.grounding : null;
    const kind = canned.canned
      ? "fallback"
      : declared ??
        classifyGrounding({
          ragSourceCount: trace.ragSourceCount,
          cited,
          tools: trace.tools,
        });
    // source 只影响报告口径说明：trace_metadata 是运行时写的分型，
    // inferred 是按 traces/spans 反推的旧口径，两者混用时报告要标注。
    const grounding = {
      ...trace,
      kind,
      source: declared ? "trace_metadata" : "inferred",
    };
    const groundingGate = trace.groundingGate ?? null;

    let goldenAgreement;
    if (kind === "kb") {
      // 没有期望命中文档（负样本）时判官从未判过 golden，不能伪造「适用」，
      // 否则下游会把它当成「判官没给结论」而记成判官故障。
      const hasGoldenDocs = (item.expectedDocIds ?? []).length > 0;
      goldenAgreement = hasGoldenDocs
        ? { ...(item.judge.goldenAgreement ?? {}), applicable: true }
        : {
            applicable: false,
            faithful: null,
            score: null,
            reason: "no_golden_documents",
            tools: trace.tools,
          };
    } else {
      goldenAgreement = {
        applicable: false,
        faithful: null,
        score: null,
        reason:
          kind === "tool"
            ? "tool_data_not_in_sources"
            : kind === "fallback"
              ? "canned_reply"
              : "no_grounding",
        tools: trace.tools,
      };
    }

    return {
      ...item,
      grounding,
      groundingGate,
      judge: {
        ...item.judge,
        grounding,
        canned: canned.canned,
        cannedKind: canned.kind,
        answered: Boolean(content) && !canned.canned,
        goldenAgreement,
      },
    };
  });
}

/** 收集一批用例里所有回答消息 id（用于一次查询）。 */
export function collectMessageIds(cases) {
  const ids = [];
  for (const item of cases ?? []) {
    for (const round of item?.rounds ?? []) {
      const id = round?.reply?.messageId;
      if (id) ids.push(id);
    }
  }
  return ids;
}
