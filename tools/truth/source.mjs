export class SourceError extends Error {
  name = "SourceError";
}

const OK_CODE = 10000;
const CHANNEL_FIELDS = ["code", "name", "type", "minAmount", "maxAmount", "feeRate", "feeFixed", "status"];
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

function assertChannelShape(channel, index) {
  if (!channel || typeof channel !== "object") {
    throw new SourceError(`来源结构不符：list[${index}] 不是对象`);
  }
  for (const field of CHANNEL_FIELDS) {
    if (channel[field] === undefined || channel[field] === null || channel[field] === "") {
      throw new SourceError(`来源结构不符：渠道 ${channel.code ?? `list[${index}]`} 缺字段 ${field}`);
    }
  }
}

/**
 * 管理员只读 HTTP 来源（design D3 / D4）。
 *
 * 只发 GET；任何非 2xx、超时、信封错误码、结构不符都抛 SourceError——
 * 不可达是失败，不是"跳过"。
 */
export function createHttpSource({ baseUrl, token, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
  if (!baseUrl) throw new SourceError("缺少 baseUrl");
  if (!token) throw new SourceError("缺少管理员令牌");

  const root = baseUrl.replace(/\/+$/, "");

  async function getJson(pathname) {
    let response;
    try {
      response = await fetchImpl(`${root}${pathname}`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") {
        throw new SourceError(`请求超时（${timeoutMs}ms）：GET ${pathname}`);
      }
      // Node 的 fetch 只给 "fetch failed"，真正原因在 cause.code（如 ECONNREFUSED）。
      const cause = error?.cause?.code ? `（${error.cause.code}）` : "";
      throw new SourceError(`请求失败：GET ${pathname}：${error?.message ?? error}${cause}`);
    }

    if (!response.ok) {
      throw new SourceError(`HTTP ${response.status}：GET ${pathname}`);
    }

    let text;
    try {
      text = await response.text();
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") {
        throw new SourceError(`读取响应超时（${timeoutMs}ms）：GET ${pathname}`);
      }
      throw new SourceError(`读取响应失败：GET ${pathname}：${error?.message ?? error}`);
    }

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new SourceError(`来源结构不符：GET ${pathname} 返回的不是 JSON`);
    }

    if (!body || typeof body !== "object" || !("data" in body)) {
      throw new SourceError(`来源结构不符：GET ${pathname} 没有 data 信封`);
    }
    if (body.code !== OK_CODE) {
      throw new SourceError(`业务错误码 ${body.code}：GET ${pathname}：${body.message ?? ""}`);
    }
    return body.data;
  }

  return {
    /** 读取某类渠道配置（type 1=入金 2=提现）。 */
    async listChannels(type) {
      const pathname = `/admin/payment/channels/list?type=${encodeURIComponent(type)}&pageSize=${PAGE_SIZE}`;
      const data = await getJson(pathname);
      if (!data || !Array.isArray(data.list)) {
        throw new SourceError(`来源结构不符：GET ${pathname} 的 data.list 不是数组`);
      }
      data.list.forEach(assertChannelShape);
      return data.list;
    },

    /** 按业务键 docId 取线上正在服务的文档正文。 */
    async getDocument(docId) {
      let page = 1;
      let seen = 0;
      for (let attempt = 0; attempt < MAX_PAGES; attempt += 1) {
        const pathname = `/admin/rag/documents?isActive=true&page=${page}&pageSize=${PAGE_SIZE}`;
        const data = await getJson(pathname);
        if (!data || !Array.isArray(data.list)) {
          throw new SourceError(`来源结构不符：GET ${pathname} 的 data.list 不是数组`);
        }
        if (typeof data.total !== "number") {
          throw new SourceError(`来源结构不符：GET ${pathname} 缺 total`);
        }

        const found = data.list.find((document) => document?.docId === docId);
        if (found) {
          if (typeof found.content !== "string" || found.content.length === 0) {
            throw new SourceError(`来源结构不符：文档「${docId}」没有正文`);
          }
          if (typeof found.version !== "number" || typeof found.activeVersion !== "number") {
            throw new SourceError(`来源结构不符：文档「${docId}」缺 version/activeVersion`);
          }
          return {
            id: found.id,
            docId: found.docId,
            content: found.content,
            version: found.version,
            activeVersion: found.activeVersion,
            isActive: found.isActive,
          };
        }

        seen += data.list.length;
        if (data.list.length === 0 || seen >= data.total) {
          throw new SourceError(`找不到文档「${docId}」（已翻 ${page} 页，共 ${seen}/${data.total} 篇）`);
        }
        page += 1;
      }
      throw new SourceError(`找不到文档「${docId}」（超过 ${MAX_PAGES} 页上限，疑似分页异常）`);
    },
  };
}
