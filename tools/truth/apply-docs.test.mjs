import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const CLI = fileURLToPath(new URL("./apply-docs.mjs", import.meta.url));

function envelope(data) {
  return JSON.stringify({ code: 10000, message: "success", data });
}

function fixture(docId) {
  return readFileSync(new URL(`./fixtures/docs/${docId}.md`, import.meta.url), "utf8");
}

test("只对内容不同的文档发 PATCH，并等到 activeVersion 切换", async () => {
  const wanted = { "deposit-guide": fixture("deposit-guide"), "withdrawal-guide": fixture("withdrawal-guide") };
  const patches = [];
  const documents = [
    { id: "uuid-deposit", docId: "deposit-guide", content: wanted["deposit-guide"], version: 3, activeVersion: 3, isActive: true },
    { id: "uuid-withdrawal", docId: "withdrawal-guide", content: "# 旧内容", version: 5, activeVersion: 5, isActive: true },
  ];

  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://stub");
    response.writeHead(200, { "content-type": "application/json" });

    if (request.method === "GET" && url.pathname === "/admin/rag/documents") {
      response.end(envelope({ page: 1, pageSize: 100, total: documents.length, list: documents }));
      return;
    }
    if (request.method === "PATCH" && /^\/admin\/rag\/documents\/[^/]+\/content$/.test(url.pathname)) {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        const parsed = JSON.parse(body);
        patches.push({ pathname: url.pathname, content: parsed.content });
        documents[1].version = 6;
        documents[1].activeVersion = 5;
        response.end(envelope({ id: "uuid-withdrawal", version: 6, activeVersion: 5 }));
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/admin/rag/documents/uuid-withdrawal") {
      documents[1].activeVersion = 6;
      response.end(envelope(documents[1]));
      return;
    }
    response.writeHead(404).end("{}");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const { stdout } = await run(
      process.execPath,
      [CLI, "--base-url", `http://127.0.0.1:${port}`, "--poll-interval-ms", "10", "--poll-timeout-ms", "5000"],
      { timeout: 20000, env: { ...process.env, TRUTH_ADMIN_TOKEN: "TOKEN" } },
    );
    assert.equal(patches.length, 1);
    assert.match(patches[0].pathname, /uuid-withdrawal/);
    assert.equal(patches[0].content, wanted["withdrawal-guide"]);
    assert.match(stdout, /deposit-guide.*无需变更/);
    assert.match(stdout, /withdrawal-guide/);
    assert.match(stdout, /activeVersion/);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("缺令牌：退出码 1，不发起任何写请求", async () => {
  await assert.rejects(run(process.execPath, [CLI, "--base-url", "http://127.0.0.1:1"], { timeout: 15000 }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /TRUTH_ADMIN_TOKEN|--token/);
    return true;
  });
});
