export class CellParseError extends Error {
  name = "CellParseError";
}

const RATE_FIXED = /^([\d.]+)\s*%\s*\+\s*(?:₱|PHP|P)?\s*([\d,]+(?:\.\d+)?)$/i;
const RATE = /^([\d.]+)\s*%(?:\s*(?:fee|charge))?$/i;
const MONEY = /^(?:₱|PHP|P)?\s*([\d,]+(?:\.\d+)?)(?:\s*(?:fee|flat))?$/i;
const FREE = /^(?:free|no\s*fee|none)$/i;

const SUPPORTED_FORMS = ["flat", "rate_plus_fixed", "amount"];

function toNumber(text) {
  return Number(text.replace(/,/g, ""));
}

function toRate(percentText) {
  return Number((Number(percentText) / 100).toFixed(6));
}

/** 只按文本本身判定它写了什么形式，不看登记。 */
function parseObserved(raw) {
  if (FREE.test(raw)) return { kind: "flat", value: 0 };
  const rateFixed = raw.match(RATE_FIXED);
  if (rateFixed) return { kind: "rate_plus_fixed", rate: toRate(rateFixed[1]), fixed: toNumber(rateFixed[2]) };
  const rate = raw.match(RATE);
  if (rate) return { kind: "rate", rate: toRate(rate[1]) };
  const money = raw.match(MONEY);
  if (money) return { kind: "money", value: toNumber(money[1]) };
  throw new CellParseError(`无法解析单元格「${raw}」：既不是金额、也不是比例、也不是 Free`);
}

/**
 * 按登记声明的形式解析单元格取值（design D8）。
 *
 * 形式不符即抛错——`₱15` 与 `0.8% + ₱5` 不能直接比大小，形式本身就是可观察的错误。
 * 例外：登记为 rate_plus_fixed、单元格只写比例时返回 `fixed: null`，
 * 由比对器结合真值的固定费判断（真值固定费为 0 时合法）。
 *
 * @returns {{ form: string, amount?: number, rate?: number, fixed?: number|null, raw: string }}
 */
export function parseCell(text, expectForm) {
  if (!SUPPORTED_FORMS.includes(expectForm)) {
    throw new CellParseError(`未知的 expectForm「${expectForm}」，只支持 ${SUPPORTED_FORMS.join(" / ")}`);
  }

  const raw = String(text ?? "").trim();
  if (raw.length === 0) throw new CellParseError("单元格为空，无法解析");

  const observed = parseObserved(raw);

  if (expectForm === "amount") {
    if (observed.kind !== "money") {
      throw new CellParseError(`登记为金额，但单元格「${raw}」不是金额`);
    }
    return { form: "amount", amount: observed.value, raw };
  }

  if (expectForm === "flat") {
    if (observed.kind === "flat") return { form: "flat", fixed: 0, raw };
    if (observed.kind === "money") return { form: "flat", fixed: observed.value, raw };
    throw new CellParseError(`登记为固定费用，但单元格「${raw}」写的是比例`);
  }

  // expectForm === "rate_plus_fixed"
  if (observed.kind === "rate_plus_fixed") {
    return { form: "rate_plus_fixed", rate: observed.rate, fixed: observed.fixed, raw };
  }
  if (observed.kind === "rate") {
    return { form: "rate", rate: observed.rate, fixed: null, raw };
  }
  throw new CellParseError(`登记为比例 + 固定费用，但单元格「${raw}」没有比例部分`);
}
