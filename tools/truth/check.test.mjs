import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const CLI = fileURLToPath(new URL("./check.mjs", import.meta.url));

function envelope(data) {
  return JSON.stringify({ code: 10000, message: "success", data });
}

const CHANNELS = [
  { code: "PH_GCASH", name: "GCash", type: 1, minAmount: "50.00", maxAmount: "50000.00", feeRate: "0.0000", feeFixed: "0.00", status: 1 },
  { code: "PH_PAYMAYA", name: "PayMaya", type: 1, minAmount: "50.00", maxAmount: "50000.00", feeRate: "0.0000", feeFixed: "0.00", status: 1 },
  { code: "PH_BDO", name: "BDO Online", type: 1, minAmount: "100.00", maxAmount: "80000.00", feeRate: "0.0100", feeFixed: "0.00", status: 1 },
  { code: "PH_GCASH_WITHDRAW", name: "GCash Withdraw", type: 2, minAmount: "100.00", maxAmount: "50000.00", feeRate: "0.0080", feeFixed: "5.00", status: 1 },
  { code: "PH_BANK_WITHDRAW", name: "Bank Transfer", type: 2, minAmount: "200.00", maxAmount: "100000.00", feeRate: "0.0100", feeFixed: "10.00", status: 1 },
];

function markers(code) {
  return ["available", "fee", "min", "max"].map((facet) => ` <!-- truth: ${code}.${facet} -->`).join("");
}

function tableRow(method, min, max, fee, code) {
  return `| **${method}** | 渠道而异 | ${min} | ${max} | ${fee}${markers(code)} |`;
}

const HEADER = [
  "| Method | Processing Time | Min Amount | Max Amount | Fee |",
  "|:-------|:---------------:|:----------:|:----------:|:---:|",
];

function depositDoc({ gcashFee = "Free", extraRow } = {}) {
  return [
    "# Deposit Guide",
    "",
    ...HEADER,
    tableRow("GCash", "₱50", "₱50,000", gcashFee, "PH_GCASH"),
    tableRow("PayMaya / Maya", "₱50", "₱50,000", "Free", "PH_PAYMAYA"),
    tableRow("BDO Online", "₱100", "₱80,000", "1%", "PH_BDO"),
    ...(extraRow ? [extraRow] : []),
  ].join("\n");
}

function withdrawalDoc() {
  return [
    "# Withdrawal Guide",
    "",
    ...HEADER,
    tableRow("GCash", "₱100", "₱50,000", "0.8% + ₱5", "PH_GCASH_WITHDRAW"),
    tableRow("Bank Transfer (InstaPay)", "₱200", "₱100,000", "1% + ₱10", "PH_BANK_WITHDRAW"),
  ].join("\n");
}

const CLEAN_PROMPT = {
  name: "wallet",
  status: "active",
  activeVersion: 5,
  versions: [{ version: 5, isActive: true, config: { role: "You are the wallet assistant." } }],
};

async function withStub(documents, runTest, prompts = [CLEAN_PROMPT]) {
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://stub");
    response.writeHead(200, { "content-type": "application/json" });
    if (url.pathname === "/admin/payment/channels/list") {
      const type = url.searchParams.get("type");
      const list = CHANNELS.filter((channel) => String(channel.type) === type);
      response.end(envelope({ page: 1, pageSize: 100, total: list.length, list }));
      return;
    }
    if (url.pathname === "/admin/rag/documents") {
      const list = Object.entries(documents).map(([docId, content]) => ({ docId, content, version: 1, activeVersion: 1, isActive: true }));
      response.end(envelope({ page: 1, pageSize: 100, total: list.length, list }));
      return;
    }
    if (url.pathname === "/admin/ai-prompt") {
      response.end(envelope({ page: 1, pageSize: 100, total: prompts.length, items: prompts }));
      return;
    }
    response.writeHead(404).end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    return await runTest(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("全绿：退出码 0，逐条输出声明与结论", async () => {
  await withStub({ "deposit-guide": depositDoc(), "withdrawal-guide": withdrawalDoc() }, async (baseUrl) => {
    const { stdout } = await run(process.execPath, [CLI, "--base-url", baseUrl, "--token", "T"], { timeout: 15000 });
    assert.match(stdout, /PH_GCASH\.fee/);
    assert.match(stdout, /通过/);
    assert.match(stdout, /共 20 条比对：20 通过，0 失败/);
    assert.match(stdout, /提示词扫描：1 个生效版本，0 处字面量/);
    assert.doesNotMatch(stdout, /阻断：/);
  });
});

test("该环境没有生效提示词：退出码 0，报告写明 0 个而不是装作扫过", async () => {
  await withStub(
    { "deposit-guide": depositDoc(), "withdrawal-guide": withdrawalDoc() },
    async (baseUrl) => {
      const { stdout } = await run(process.execPath, [CLI, "--base-url", baseUrl, "--token", "T"], { timeout: 15000 });
      assert.match(stdout, /提示词扫描：0 个生效版本（该环境未启用 DB 提示词，运行期使用代码默认配置），0 处字面量/);
      assert.doesNotMatch(stdout, /阻断：/);
    },
    [],
  );
});

test("提示词写死费率：退出码 1，报告指出提示词与版本", async () => {
  const dirty = {
    name: "wallet",
    status: "active",
    activeVersion: 5,
    versions: [{ version: 5, isActive: true, config: { role: "Withdrawal fee is 0.8%." } }],
  };
  await withStub(
    { "deposit-guide": depositDoc(), "withdrawal-guide": withdrawalDoc() },
    async (baseUrl) => {
      await assert.rejects(
        run(process.execPath, [CLI, "--base-url", baseUrl, "--token", "T"], { timeout: 15000 }),
        (error) => {
          assert.equal(error.code, 1);
          assert.match(error.stdout, /提示词「wallet」v5/);
          assert.match(error.stdout, /0\.8%/);
          return true;
        },
      );
    },
    [dirty],
  );
});

test("有失败：退出码 1，输出差异与失败条数", async () => {
  await withStub({ "deposit-guide": depositDoc({ gcashFee: "₱10" }), "withdrawal-guide": withdrawalDoc() }, async (baseUrl) => {
    await assert.rejects(
      run(process.execPath, [CLI, "--base-url", baseUrl, "--token", "T"], { timeout: 15000 }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stdout, /PH_GCASH\.fee/);
        assert.match(error.stdout, /₱10/);
        assert.match(error.stdout, /₱0/);
        assert.match(error.stdout, /1 失败/);
        return true;
      },
    );
  });
});

test("文档缺标记：退出码 1，报出缺标记的行", async () => {
  const extraRow = "| **Cash in at Store** | 1 day | ₱100 | ₱1,000 | ₱10 |";
  await withStub({ "deposit-guide": depositDoc({ extraRow }), "withdrawal-guide": withdrawalDoc() }, async (baseUrl) => {
    await assert.rejects(
      run(process.execPath, [CLI, "--base-url", baseUrl, "--token", "T"], { timeout: 15000 }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stdout, /\[missing-marker\]/);
        assert.match(error.stdout, /Cash in at Store/);
        return true;
      },
    );
  });
});

test("缺参数：退出码 1 且说明用法，不打印令牌", async () => {
  await assert.rejects(run(process.execPath, [CLI], { timeout: 15000 }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /--base-url/);
    assert.match(error.stderr, /--token/);
    return true;
  });
});

test("--docs 限定到未登记文档：退出码 1，不静默跳过", async () => {
  await withStub({ "deposit-guide": depositDoc(), "withdrawal-guide": withdrawalDoc() }, async (baseUrl) => {
    await assert.rejects(
      run(process.execPath, [CLI, "--base-url", baseUrl, "--token", "T", "--docs", "not-registered"], { timeout: 15000 }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stdout + error.stderr, /not-registered/);
        return true;
      },
    );
  });
});
