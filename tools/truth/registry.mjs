import { readFileSync } from "node:fs";

/** 登记项允许的声明形式（见 design D8）。 */
export const EXPECT_FORMS = Object.freeze(["flat", "rate_plus_fixed", "amount", "boolean"]);

/** 登记项允许的解析器版本。 */
export const PARSERS = Object.freeze(["channel-row-v1"]);

export class RegistryError extends Error {
  name = "RegistryError";
}

const FACT_STRING_FIELDS = ["docId", "row", "expectForm", "parser"];

function fail(message) {
  throw new RegistryError(message);
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) fail(`登记项 ${label} 必须是非空字符串`);
  return value;
}

function validateFact(key, fact, documents) {
  if (!fact || typeof fact !== "object" || Array.isArray(fact)) fail(`登记项 ${key} 必须是对象`);
  for (const field of FACT_STRING_FIELDS) requireNonEmptyString(fact[field], `${key} 的 ${field}`);

  if (!documents.includes(fact.docId)) fail(`登记项 ${key} 的 docId "${fact.docId}" 不在 documents 列表里`);
  if (!EXPECT_FORMS.includes(fact.expectForm)) fail(`登记项 ${key} 的 expectForm 非法："${fact.expectForm}"`);
  if (!PARSERS.includes(fact.parser)) fail(`登记项 ${key} 的 parser 未知："${fact.parser}"`);

  const source = fact.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) fail(`登记项 ${key} 缺 source`);
  if (source.kind !== "payment_channel") fail(`登记项 ${key} 的 source.kind 必须是 payment_channel`);
  requireNonEmptyString(source.code, `${key} 的 source.code`);
  if (![1, 2].includes(source.type)) fail(`登记项 ${key} 的 source.type 必须是 1（入金）或 2（提现）`);
  if (!Array.isArray(source.fields) || source.fields.length === 0) fail(`登记项 ${key} 的 source.fields 必须是非空数组`);
  for (const field of source.fields) requireNonEmptyString(field, `${key} 的 source.fields[]`);

  if (fact.column !== null && fact.column !== undefined) requireNonEmptyString(fact.column, `${key} 的 column`);
}

function validateUnsourced(entries, documents) {
  if (!Array.isArray(entries)) fail("unsourced 必须是数组，没有无来源事实时写 []");
  entries.forEach((entry, index) => {
    const label = `unsourced[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(`${label} 必须是对象`);
    requireNonEmptyString(entry.type, `${label} 的 type`);
    requireNonEmptyString(entry.reason, `${label} 的 reason`);
    if (!Array.isArray(entry.documents) || entry.documents.length === 0) {
      fail(`${label} 的 documents 必须是非空数组`);
    }
    for (const docId of entry.documents) {
      if (!documents.includes(docId)) fail(`${label} 的 documents 含未声明文档 "${docId}"`);
    }
    requireNonEmptyString(entry.decision, `${label} 的 decision`);
  });
}

/**
 * 校验并返回登记对象。只读、无缓存——每次调用都重新校验传入的数据
 * （design D4：不缓存真值，避免旧值掩盖"不可达"）。
 */
export function parseRegistry(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("登记文件必须是 JSON 对象");
  if (raw.version !== 1) fail(`不支持的登记版本："${raw.version}"（本工具只认 1）`);
  if (!Array.isArray(raw.documents) || raw.documents.length === 0) fail("documents 必须是非空数组");
  for (const docId of raw.documents) requireNonEmptyString(docId, "documents[]");
  if (!raw.facts || typeof raw.facts !== "object" || Array.isArray(raw.facts)) fail("facts 必须是对象");
  const keys = Object.keys(raw.facts);
  if (keys.length === 0) fail("facts 不能为空");
  for (const key of keys) validateFact(key, raw.facts[key], raw.documents);
  validateUnsourced(raw.unsourced, raw.documents);
  return raw;
}

/** 从磁盘读取并校验登记文件。任何读取/解析/校验失败都抛 RegistryError。 */
export function loadRegistry(path = new URL("./registry.json", import.meta.url)) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") fail(`找不到登记文件：${path instanceof URL ? path.pathname : path}`);
    fail(`读取登记文件失败：${error.message}`);
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    fail(`登记文件不是合法 JSON：${error.message}`);
  }
  return parseRegistry(raw);
}
