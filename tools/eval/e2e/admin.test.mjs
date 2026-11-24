import assert from "node:assert/strict";
import test from "node:test";

import { resolveAdminToken } from "./admin.mjs";

const ENV_KEYS = [
  "E2E_ADMIN_TOKEN",
  "E2E_ADMIN_TEST_USERNAME",
  "E2E_ADMIN_TEST_CODE",
  "E2E_BACKEND_CONTAINER",
];

function withEnv(values, run) {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const key of ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    });
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(payload),
  };
}

const config = { apiBaseUrl: "https://qa.example.com/api" };

const quietLogger = { warn: () => {}, log: () => {}, error: () => {} };

test("resolveAdminToken：E2E_ADMIN_TOKEN 优先，不发请求", async () => {
  await withEnv({ E2E_ADMIN_TOKEN: "preset-token" }, async () => {
    let called = false;
    const result = await resolveAdminToken(config, {
      logger: quietLogger,
      fetchImpl: async () => {
        called = true;
        throw new Error("should not fetch");
      },
    });
    assert.deepEqual(result, { token: "preset-token", source: "env" });
    assert.equal(called, false);
  });
});

test("resolveAdminToken：环境变量测试凭据换 token，凭据不进日志", async () => {
  const warnings = [];
  const calls = [];
  await withEnv(
    {
      E2E_ADMIN_TEST_USERNAME: "e2e-runner",
      E2E_ADMIN_TEST_CODE: "test-code-123",
    },
    async () => {
      const result = await resolveAdminToken(config, {
        logger: { warn: (message) => warnings.push(String(message)) },
        fetchImpl: async (url, options) => {
          calls.push({ url, options });
          return jsonResponse({
            code: 10000,
            data: { tokens: { accessToken: "fresh-token" } },
          });
        },
      });
      assert.deepEqual(result, {
        token: "fresh-token",
        source: "env-test-login",
      });
    },
  );

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v1\/auth\/admin\/test-login$/);
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    test: "e2e-runner",
    code: "test-code-123",
  });
  assert.ok(
    warnings.every((message) => !message.includes("test-code-123")),
    "日志里不能出现测试码",
  );
});

test("resolveAdminToken：test-login 失败时继续下一种来源", async () => {
  const warnings = [];
  await withEnv(
    {
      E2E_ADMIN_TEST_USERNAME: "e2e-runner",
      E2E_ADMIN_TEST_CODE: "test-code-123",
      E2E_BACKEND_CONTAINER: "__missing_container__",
    },
    async () => {
      await assert.rejects(
        () =>
          resolveAdminToken(config, {
            logger: { warn: (message) => warnings.push(String(message)) },
            fetchImpl: async () =>
              jsonResponse({ code: 401, message: "invalid credentials" }, 401),
          }),
        /无法从后端容器读取/,
      );
    },
  );
  assert.ok(warnings.some((message) => message.includes("HTTP 401")));
  assert.ok(
    warnings.every((message) => !message.includes("test-code-123")),
    "日志里不能出现测试码",
  );
});
