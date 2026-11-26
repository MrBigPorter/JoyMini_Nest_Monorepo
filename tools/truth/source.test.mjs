import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { SourceError, createHttpSource } from "./source.mjs";

function envelope(data, code = 10000) {
  return JSON.stringify({ code, message: code === 10000 ? "success" : "error", data });
}

async function withServer(handler, run) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization });
    handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`, requests);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

function respond(response, body, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(body);
}

const CHANNEL = {
  code: "PH_GCASH",
  name: "GCash",
  type: 1,
  minAmount: "50.00",
  maxAmount: "50000.00",
  feeRate: "0.0000",
  feeFixed: "0.00",
  status: 1,
};

test("200：解包 data.list，带上 Bearer 令牌与 type 过滤", async () => {
  await withServer(
    (request, response) => respond(response, envelope({ page: 1, pageSize: 100, total: 1, list: [CHANNEL] })),
    async (baseUrl, requests) => {
      const source = createHttpSource({ baseUrl, token: "TOKEN" });
      const channels = await source.listChannels(1);
      assert.equal(channels.length, 1);
      assert.equal(channels[0].code, "PH_GCASH");
      assert.match(requests[0].url, /\/admin\/payment\/channels\/list\?/);
      assert.match(requests[0].url, /type=1/);
      assert.equal(requests[0].authorization, "Bearer TOKEN");
    },
  );
});

test("404：抛 SourceError，消息带状态码与路径", async () => {
  await withServer(
    (_request, response) => respond(response, envelope(null, 404), 404),
    async (baseUrl) => {
      const source = createHttpSource({ baseUrl, token: "TOKEN" });
      await assert.rejects(source.listChannels(2), (error) => {
        assert.ok(error instanceof SourceError);
        assert.match(error.message, /404/);
        assert.match(error.message, /payment\/channels/);
        return true;
      });
    },
  );
});

test("超时：服务端不响应时抛 SourceError，不死等", async () => {
  await withServer(
    () => {},
    async (baseUrl) => {
      const source = createHttpSource({ baseUrl, token: "TOKEN", timeoutMs: 50 });
      await assert.rejects(source.listChannels(1), (error) => {
        assert.ok(error instanceof SourceError);
        assert.match(error.message, /超时/);
        return true;
      });
    },
  );
});

test("结构不符：list 条目缺字段时失败，不把空值当真值", async () => {
  await withServer(
    (_request, response) => respond(response, envelope({ page: 1, pageSize: 100, total: 1, list: [{ code: "PH_X" }] })),
    async (baseUrl) => {
      const source = createHttpSource({ baseUrl, token: "TOKEN" });
      await assert.rejects(source.listChannels(1), (error) => {
        assert.ok(error instanceof SourceError);
        assert.match(error.message, /结构/);
        assert.match(error.message, /feeRate|maxAmount|minAmount|feeFixed|status|type|name/);
        return true;
      });
    },
  );
});

test("结构不符：data 为 null 时失败", async () => {
  await withServer(
    (_request, response) => respond(response, envelope(null)),
    async (baseUrl) => {
      const source = createHttpSource({ baseUrl, token: "TOKEN" });
      await assert.rejects(source.listChannels(1), SourceError);
    },
  );
});

test("业务错误码：code 非 10000 时失败并报出 code", async () => {
  await withServer(
    (_request, response) => respond(response, envelope(null, 40009)),
    async (baseUrl) => {
      const source = createHttpSource({ baseUrl, token: "TOKEN" });
      await assert.rejects(source.listChannels(1), (error) => {
        assert.match(error.message, /40009/);
        return true;
      });
    },
  );
});

test("连接被拒：错误里带底层原因码，而不是只有 fetch failed", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));

  const source = createHttpSource({ baseUrl: `http://127.0.0.1:${port}`, token: "TOKEN" });
  await assert.rejects(source.listChannels(1), (error) => {
    assert.ok(error instanceof SourceError);
    assert.match(error.message, /ECONNREFUSED/);
    return true;
  });
});

test("文档：跨页解析 docId，取到正文", async () => {
  await withServer(
    (request, response) => {
      const url = new URL(request.url, "http://stub");
      if (url.searchParams.get("page") === "1") {
        respond(response, envelope({ page: 1, pageSize: 100, total: 2, list: [{ docId: "other", content: "# Other", version: 2, activeVersion: 2 }] }));
      } else {
        respond(response, envelope({ page: 2, pageSize: 100, total: 2, list: [{ id: "uuid-target", docId: "target", content: "# Target", version: 7, activeVersion: 6 }] }));
      }
    },
    async (baseUrl, requests) => {
      const source = createHttpSource({ baseUrl, token: "TOKEN" });
      const document = await source.getDocument("target");
      assert.equal(document.id, "uuid-target");
      assert.equal(document.docId, "target");
      assert.equal(document.content, "# Target");
      assert.equal(document.version, 7);
      assert.equal(document.activeVersion, 6);
      assert.equal(requests.length, 2);
      assert.match(requests[0].url, /isActive=true/);
    },
  );
});

test("文档缺 activeVersion：按结构不符失败，不默认等于 version", async () => {
  await withServer(
    (_request, response) =>
      respond(response, envelope({ page: 1, pageSize: 100, total: 1, list: [{ docId: "target", content: "# Target", version: 3 }] })),
    async (baseUrl) => {
      const source = createHttpSource({ baseUrl, token: "TOKEN" });
      await assert.rejects(source.getDocument("target"), (error) => {
        assert.ok(error instanceof SourceError);
        assert.match(error.message, /activeVersion/);
        return true;
      });
    },
  );
});

test("文档：找不到 docId 时失败并报出 docId", async () => {
  await withServer(
    (_request, response) => respond(response, envelope({ page: 1, pageSize: 100, total: 1, list: [{ docId: "other", content: "# Other" }] })),
    async (baseUrl) => {
      const source = createHttpSource({ baseUrl, token: "TOKEN" });
      await assert.rejects(source.getDocument("target"), (error) => {
        assert.ok(error instanceof SourceError);
        assert.match(error.message, /target/);
        return true;
      });
    },
  );
});
