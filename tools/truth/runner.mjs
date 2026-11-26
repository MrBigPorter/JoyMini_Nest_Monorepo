import { compare } from "./compare.mjs";
import { loadRegistry } from "./registry.mjs";

const EMPTY = Object.freeze({ results: [], errors: [], blockers: [], compared: 0 });

/**
 * 跑一次完整校验，返回结构化结论（design D4：四种情况一律失败，不跳过）。
 *
 * @param {object} input
 * @param {Function} [input.loadRegistryFn] 注入用于测试；默认读 tools/truth/registry.json
 * @param {object} input.source 来源适配器（createHttpSource 的返回值）
 * @param {string[]} [input.docIds] 限定只校验这些文档；出现未登记的 docId 直接失败
 * @returns {Promise<{status: "pass"|"fail", results: Array, errors: Array, blockers: string[], compared: number}>}
 */
export async function runCheck({ loadRegistryFn = loadRegistry, source, docIds }) {
  let registry;
  try {
    registry = loadRegistryFn();
  } catch (error) {
    return { ...EMPTY, status: "fail", blockers: [`登记不可解析：${error.message}`] };
  }

  if (docIds && docIds.length > 0) {
    const unknown = docIds.filter((docId) => !registry.documents.includes(docId));
    if (unknown.length > 0) {
      return { ...EMPTY, status: "fail", blockers: [`文档「${unknown.join(", ")}」不在登记里`] };
    }
    registry = { ...registry, documents: docIds };
  }

  let channels;
  try {
    const [deposit, withdraw] = await Promise.all([source.listChannels(1), source.listChannels(2)]);
    channels = [...deposit, ...withdraw];
  } catch (error) {
    return { ...EMPTY, status: "fail", blockers: [`真值源不可达：${error.message}`] };
  }

  const contents = {};
  for (const docId of registry.documents) {
    let document;
    try {
      document = await source.getDocument(docId);
    } catch (error) {
      return { ...EMPTY, status: "fail", blockers: [`真值源不可达：取文档「${docId}」失败：${error.message}`] };
    }
    // 回滚只切分块版本，不还原 knowledge_documents.content（KbVersionService.switchTo）。
    // 索引停在旧版时，检索服务的不是正在被校验的这份正文——比对结果没有意义。
    if (document.activeVersion !== document.version) {
      return {
        ...EMPTY,
        status: "fail",
        blockers: [
          `文档「${docId}」索引未跟上：当前正文 v${document.version}，检索服务的是 v${document.activeVersion}——先让向量化完成或切回当前版本再校验`,
        ],
      };
    }
    contents[docId] = document.content;
  }

  const report = compare({ registry, contents, channels });
  const blockers = [];
  if (report.results.length === 0) {
    blockers.push("零条可比对的声明：登记、文档与解析结果没有产生任何可判定的比较");
  }

  return {
    status: blockers.length === 0 && report.ok ? "pass" : "fail",
    results: report.results,
    errors: report.errors,
    blockers,
    compared: report.results.length,
  };
}
