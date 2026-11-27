import { CellParseError, parseCell } from "./cell.mjs";
import { scanDocument } from "./scan.mjs";

const RATE_TOLERANCE = 1e-6;

function formatAmount(value) {
  const rounded = Math.round(value * 100) / 100;
  return rounded.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatRate(rate) {
  return `${Number((rate * 100).toFixed(6))}%`;
}

function formatFee(rate, fixed) {
  if (rate === 0) return `₱${formatAmount(fixed)}`;
  if (fixed === 0) return formatRate(rate);
  return `${formatRate(rate)} + ₱${formatAmount(fixed)}`;
}

function toNumber(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function sameAmount(left, right) {
  return Math.abs(left - right) < 0.005;
}

function sameRate(left, right) {
  return Math.abs(left - right) < RATE_TOLERANCE;
}

/** 单元格实际写的是哪种形式；全部解析不了返回 null。 */
function observedForm(cell) {
  for (const form of ["flat", "rate_plus_fixed", "amount"]) {
    try {
      parseCell(cell, form);
      return form;
    } catch {
      // 换下一种形式再试
    }
  }
  return null;
}

function baseResult(docId, key, fact, row) {
  return {
    docId,
    key,
    facet: key.split(".").pop(),
    column: fact.column ?? null,
    rowLabel: row.label,
    line: row.line,
  };
}

function compareAvailable(docId, key, fact, row, channel) {
  const result = baseResult(docId, key, fact, row);
  result.declared = `渠道「${row.label}」存在`;
  if (!channel) {
    return { ...result, truth: "配置中不存在", verdict: "fail", reason: "channel-missing" };
  }
  if (channel.status !== 1) {
    return { ...result, truth: `状态=${channel.status}（已停用）`, verdict: "fail", reason: "channel-disabled" };
  }
  return { ...result, truth: "状态=1（启用）", verdict: "pass" };
}

function compareAmount(docId, key, fact, row, channel) {
  const result = baseResult(docId, key, fact, row);
  const cell = row.cells[fact.column];
  result.declared = cell;
  if (!channel) {
    return { ...result, truth: "配置中不存在", verdict: "fail", reason: "channel-missing" };
  }

  const truth = fact.column === "Max Amount" ? toNumber(channel.maxAmount) : toNumber(channel.minAmount);
  result.truth = `₱${formatAmount(truth)}`;

  let parsed;
  try {
    parsed = parseCell(cell, "amount");
  } catch (error) {
    if (!(error instanceof CellParseError)) throw error;
    return { ...result, verdict: "fail", reason: observedForm(cell) ? "form-mismatch" : "unparseable", detail: error.message };
  }

  return parsed.amount === truth
    ? { ...result, verdict: "pass" }
    : { ...result, verdict: "fail", reason: "value-mismatch" };
}

function compareFee(docId, key, fact, row, channel) {
  const result = baseResult(docId, key, fact, row);
  const cell = row.cells[fact.column];
  result.declared = cell;
  if (!channel) {
    return { ...result, truth: "配置中不存在", verdict: "fail", reason: "channel-missing" };
  }

  const truthRate = toNumber(channel.feeRate);
  const truthFixed = toNumber(channel.feeFixed);
  result.truth = formatFee(truthRate, truthFixed);

  let parsed;
  try {
    parsed = parseCell(cell, fact.expectForm);
  } catch (error) {
    if (!(error instanceof CellParseError)) throw error;
    return { ...result, verdict: "fail", reason: observedForm(cell) ? "form-mismatch" : "unparseable", detail: error.message };
  }

  if (fact.expectForm === "flat") {
    if (truthRate !== 0) return { ...result, verdict: "fail", reason: "form-mismatch" };
    return sameAmount(parsed.fixed, truthFixed)
      ? { ...result, verdict: "pass" }
      : { ...result, verdict: "fail", reason: "value-mismatch" };
  }

  // rate_plus_fixed
  if (parsed.form === "rate") {
    // 只写比例：仅当真值没有固定费时成立（design D8 的窄例外）
    if (truthFixed !== 0) return { ...result, verdict: "fail", reason: "form-mismatch" };
    return sameRate(parsed.rate, truthRate)
      ? { ...result, verdict: "pass" }
      : { ...result, verdict: "fail", reason: "value-mismatch" };
  }

  return sameRate(parsed.rate, truthRate) && sameAmount(parsed.fixed, truthFixed)
    ? { ...result, verdict: "pass" }
    : { ...result, verdict: "fail", reason: "value-mismatch" };
}

/**
 * 比对"文档声明"与"业务表真值"（design D6：只问文档是否等于表）。
 *
 * @param {object} input
 * @param {object} input.registry 已校验的登记对象
 * @param {Record<string,string>} input.contents docId → 文档正文
 * @param {Array} input.channels 两个 type 的渠道配置合并数组
 * @returns {{ results: Array, errors: Array, ok: boolean }}
 */
export function compare({ registry, contents, channels }) {
  const byCode = new Map(channels.map((channel) => [channel.code, channel]));
  const errors = [];
  const rowsByDoc = new Map();

  for (const docId of registry.documents) {
    const content = contents[docId];
    if (typeof content !== "string" || content.length === 0) {
      errors.push({ kind: "document-missing", docId, message: `取不到文档「${docId}」的正文` });
      rowsByDoc.set(docId, []);
      continue;
    }
    const scan = scanDocument({ docId, content, registry });
    errors.push(...scan.errors);
    rowsByDoc.set(docId, scan.rows);
  }

  const results = [];
  for (const [key, fact] of Object.entries(registry.facts)) {
    const rows = rowsByDoc.get(fact.docId) ?? [];
    const row = rows.find((candidate) => candidate.markers.includes(key));
    if (!row) continue; // 扫描阶段已产出 missing-declaration

    const channel = byCode.get(fact.source.code);
    const compareOne =
      fact.expectForm === "boolean"
        ? compareAvailable
        : fact.expectForm === "amount"
          ? compareAmount
          : compareFee;
    results.push(compareOne(fact.docId, key, fact, row, channel));
  }

  return {
    results,
    errors,
    ok: errors.length === 0 && results.every((result) => result.verdict === "pass"),
  };
}
