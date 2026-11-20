import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "./config.mjs";
import {
  ChannelProbeError,
  accountsPath,
  generatePhone,
  loadAccounts,
  main,
  maskPhone,
  probeChannel,
  provisionAccounts,
  redactSecrets,
  refreshAccountToken,
  saveAccounts,
} from "./provision.mjs";

const CSRF = "a".repeat(64);

function jsonResponse(payload, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json", ...headers }),
    text: async () => JSON.stringify(payload),
  };
}

function createMockFetch() {
  const calls = [];
  let loginCount = 0;

  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    const headers = init.headers ?? {};
    calls.push({
      url,
      method: init.method ?? "GET",
      headers,
      body: init.body ? JSON.parse(init.body) : undefined,
    });

    if (parsed.pathname.endsWith("/health")) {
      return jsonResponse(
        { code: 404, message: "not found" },
        {
          status: 404,
          headers: {
            "x-csrf-token": CSRF,
            "set-cookie": `csrf_token=${CSRF}; Path=/; Secure; SameSite=Strict`,
          },
        },
      );
    }
    if (parsed.pathname.endsWith("/v1/otp/request")) {
      return jsonResponse({ code: 10000, message: "success", data: null });
    }
    if (parsed.pathname.endsWith("/v1/otp/verify")) {
      return jsonResponse({ code: 10000, message: "success", data: "9999" });
    }
    if (parsed.pathname.endsWith("/v1/auth/login/otp")) {
      loginCount += 1;
      return jsonResponse({
        code: 10000,
        message: "success",
        data: {
          tokens: {
            accessToken: `token-${loginCount}`,
            refreshToken: `refresh-${loginCount}`,
          },
          user: { id: `user-${loginCount}` },
        },
      });
    }
    if (parsed.pathname.endsWith("/v1/chat/business")) {
      return jsonResponse({
        code: 10000,
        message: "success",
        data: { conversationId: "conversation-1" },
      });
    }
    throw new Error(`unexpected URL: ${parsed.pathname}`);
  };

  return { fetchImpl, calls };
}

function createLogger() {
  const lines = [];
  return {
    lines,
    logger: {
      log: (message) => lines.push(String(message)),
      warn: (message) => lines.push(String(message)),
      error: (message) => lines.push(String(message)),
    },
  };
}

test("generatePhone 生成 +63917 开头的 7 位数字", () => {
  for (let i = 0; i < 500; i += 1) {
    assert.match(generatePhone(Math.random), /^\+63917\d{7}$/);
  }
});

test("maskPhone 不暴露完整手机号", () => {
  const phone = "+639171234567";
  const masked = maskPhone(phone);
  assert.notEqual(masked, phone);
  assert.ok(!masked.includes("1234567"));
});

test("redactSecrets 清掉手机号与 JWT", () => {
  const cleaned = redactSecrets(
    "phone=+639171234567 token=eyJhbGciOiJIUzI1NiJ9.payload.signature",
  );
  assert.ok(!cleaned.includes("+639171234567"));
  assert.ok(!cleaned.includes("eyJhbGciOiJIUzI1NiJ9"));
});

test("provisionAccounts 按顺序调用 OTP -> 登录，并返回账号", async () => {
  const { fetchImpl, calls } = createMockFetch();
  const { logger, lines } = createLogger();
  const config = loadConfig({ SIM_ACCOUNT_COUNT: "2" });

  const accounts = await provisionAccounts({
    count: 2,
    config,
    fetchImpl,
    sleep: async () => {},
    logger,
  });

  assert.equal(accounts.length, 2);
  for (const account of accounts) {
    assert.match(account.phone, /^\+63917\d{7}$/);
    assert.match(account.userId, /^user-\d+$/);
    assert.match(account.token, /^token-\d+$/);
    assert.match(account.refreshToken, /^refresh-\d+$/);
    assert.equal(account.deviceId.startsWith(`sim-${account.phone}-`), true);
    assert.deepEqual(Object.keys(account).sort(), [
      "deviceId",
      "phone",
      "refreshToken",
      "token",
      "userId",
    ]);
  }
  assert.equal(new Set(accounts.map((a) => a.phone)).size, 2);

  const postCalls = calls.filter((call) => call.method === "POST");
  assert.deepEqual(
    postCalls.map((call) => new URL(call.url).pathname),
    [
      "/api/v1/otp/request",
      "/api/v1/otp/verify",
      "/api/v1/auth/login/otp",
      "/api/v1/otp/request",
      "/api/v1/otp/verify",
      "/api/v1/auth/login/otp",
    ],
  );
  assert.equal(postCalls[0].body.phone, accounts[0].phone);
  assert.equal(postCalls[1].body.code, "999999");
  assert.equal(postCalls[2].body.phone, accounts[0].phone);

  // OTP POST 必须带合法的 CSRF cookie + header，而不是绕过
  for (const call of postCalls) {
    assert.equal(call.headers["x-csrf-token"], CSRF);
    assert.equal(call.headers.cookie, `csrf_token=${CSRF}`);
  }

  const logs = lines.join("\n");
  for (const account of accounts) {
    assert.ok(!logs.includes(account.phone), "日志不能出现手机号");
    assert.ok(!logs.includes(account.token), "日志不能出现 token");
  }
});

test("provisionAccounts 兼容 data.id 老响应形态", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    calls.push(parsed.pathname);
    if (parsed.pathname.endsWith("/health")) {
      return jsonResponse({ code: 404 }, { status: 404 });
    }
    if (parsed.pathname.endsWith("/auth/login/otp")) {
      return jsonResponse({
        code: 10000,
        data: {
          tokens: {
            accessToken: "legacy-token",
            refreshToken: "legacy-refresh",
          },
          id: "legacy-user",
        },
      });
    }
    return jsonResponse({ code: 10000, data: null });
  };
  const { logger } = createLogger();

  const [account] = await provisionAccounts({
    count: 1,
    config: loadConfig({}),
    fetchImpl,
    sleep: async () => {},
    logger,
  });

  assert.equal(account.userId, "legacy-user");
  assert.equal(account.token, "legacy-token");
});

test("provisionAccounts 每 5 个账号等待一次，最后一组不等待", async () => {
  const { fetchImpl } = createMockFetch();
  const { logger } = createLogger();
  const sleeps = [];

  await provisionAccounts({
    count: 6,
    config: loadConfig({}),
    fetchImpl,
    sleep: async (ms) => sleeps.push(ms),
    logger,
    batchSize: 5,
    batchWaitMs: 1234,
  });

  assert.deepEqual(sleeps, [1234]);
});

test("provisionAccounts 遇到 429 会按 Retry-After 重试", async () => {
  let attempts = 0;
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/health")) {
      return jsonResponse({ code: 404 }, { status: 404 });
    }
    if (parsed.pathname.endsWith("/v1/otp/request")) {
      attempts += 1;
      if (attempts === 1) {
        return jsonResponse(
          { code: 429, message: "too many requests" },
          { status: 429, headers: { "retry-after": "2" } },
        );
      }
      return jsonResponse({ code: 10000, data: null });
    }
    if (parsed.pathname.endsWith("/auth/login/otp")) {
      return jsonResponse({
        code: 10000,
        data: {
          tokens: { accessToken: "t", refreshToken: "r" },
          user: { id: "u" },
        },
      });
    }
    return jsonResponse({ code: 10000, data: null });
  };
  const { logger } = createLogger();
  const sleeps = [];

  const [account] = await provisionAccounts({
    count: 1,
    config: loadConfig({}),
    fetchImpl,
    sleep: async (ms) => sleeps.push(ms),
    logger,
  });

  assert.equal(attempts, 2);
  assert.equal(account.userId, "u");
  assert.deepEqual(sleeps, [2000]);
});

test("probeChannel 在 404/403 时提示先创建渠道", async () => {
  const fetchImpl = async () =>
    jsonResponse(
      { code: 404, message: "Support channel not found or inactive" },
      { status: 404 },
    );

  await assert.rejects(
    () => probeChannel(loadConfig({}), "token", { fetchImpl }),
    (error) => {
      assert.ok(error instanceof ChannelProbeError);
      assert.match(error.message, /simulation_support_v1/);
      assert.match(error.message, /support-channels/);
      assert.match(error.message, /不会自动创建/);
      return true;
    },
  );
});

test("probeChannel 成功时返回 conversationId", async () => {
  const { fetchImpl } = createMockFetch();
  const conversationId = await probeChannel(loadConfig({}), "token", {
    fetchImpl,
  });
  assert.equal(conversationId, "conversation-1");
});

test("refreshAccountToken 用 refreshToken 换新 token 并保留其余字段", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    calls.push({
      pathname: parsed.pathname,
      method: init.method,
      headers: init.headers,
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    return jsonResponse({
      code: 10000,
      message: "success",
      data: {
        tokens: {
          accessToken: "new-access-token",
          refreshToken: "new-refresh-token",
        },
      },
    });
  };

  const account = {
    phone: "+639171234567",
    userId: "u1",
    token: "old-access-token",
    refreshToken: "old-refresh-token",
    deviceId: "sim-+639171234567-abcd1234",
  };
  const refreshed = await refreshAccountToken(loadConfig({}), account, {
    fetchImpl,
  });

  assert.deepEqual(refreshed, {
    ...account,
    token: "new-access-token",
    refreshToken: "new-refresh-token",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pathname, "/api/v1/auth/refresh");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, { refreshToken: "old-refresh-token" });
  assert.equal(calls[0].headers["x-device-id"], account.deviceId);
});

test("refreshAccountToken 缺少 refreshToken 时明确报错", async () => {
  await assert.rejects(
    () =>
      refreshAccountToken(
        loadConfig({}),
        { phone: "+639171234567", userId: "u1", token: "t", deviceId: "d" },
        { fetchImpl: async () => jsonResponse({ code: 10000, data: null }) },
      ),
    /refreshToken/,
  );
});

test("main 在 --skip-channel-check 时输出警告并落盘 refreshToken", async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sim-main-"));
  try {
    const config = loadConfig({ SIM_RUNTIME_DIR: dir });
    const { fetchImpl } = createMockFetch();
    const { logger, lines } = createLogger();

    const code = await main(["--count", "1", "--skip-channel-check"], {
      config,
      fetchImpl,
      sleep: async () => {},
      logger,
    });

    assert.equal(code, 0);
    assert.ok(lines.some((line) => line.includes("跳过渠道")));
    const saved = loadAccounts(dir);
    assert.equal(saved.length, 1);
    assert.match(saved[0].refreshToken, /^refresh-\d+$/);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

test("saveAccounts 写入 600 权限文件，loadAccounts 可读回", async () => {
  const dir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "sim-accounts-"),
  );
  const accounts = [
    {
      phone: "+639170000001",
      userId: "u1",
      token: "t1",
      refreshToken: "r1",
      deviceId: "sim-+639170000001-abcd1234",
    },
  ];

  try {
    saveAccounts(dir, accounts);
    assert.deepEqual(loadAccounts(dir), accounts);
    assert.equal(accountsPath(dir), path.join(dir, "accounts.json"));
    assert.equal((await fs.promises.stat(dir)).mode & 0o777, 0o700);
    assert.equal(
      (await fs.promises.stat(accountsPath(dir))).mode & 0o777,
      0o600,
    );
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

test("loadAccounts 对缺失文件返回空数组，对坏数据抛错", async () => {
  const dir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "sim-accounts-"),
  );
  try {
    assert.deepEqual(loadAccounts(dir), []);
    fs.writeFileSync(accountsPath(dir), JSON.stringify([{ phone: 1 }]));
    assert.throws(() => loadAccounts(dir), /accounts\.json/);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});
