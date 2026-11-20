import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { DEFAULTS, SIMULATOR_DIR, apiUrl, loadConfig } from "./config.mjs";

test("loadConfig 返回计划约定的默认值", () => {
  const config = loadConfig({});

  assert.equal(config.apiBaseUrl, "https://api.joyminis.com/api");
  assert.equal(config.socketUrl, "https://api.joyminis.com/events");
  assert.equal(config.businessId, "simulation_support_v1");
  assert.equal(config.trafficSource, "simulation_support_v1");
  assert.equal(config.accountCount, 30);
  assert.equal(config.concurrency, 5);
  assert.equal(config.otpCode, "999999");
  assert.equal(config.runtimeDir, path.join(SIMULATOR_DIR, ".runtime"));
});

test("loadConfig 读取 env 覆盖并去掉末尾斜杠", () => {
  const config = loadConfig({
    SIM_API_BASE_URL: "http://localhost:3000/api/",
    SIM_SOCKET_URL: "http://localhost:3000/events/",
    SIM_BUSINESS_ID: "simulation_test",
    SIM_ACCOUNT_COUNT: "2",
    SIM_CONCURRENCY: "1",
    SIM_OTP_CODE: "123456",
    SIM_RUNTIME_DIR: "/tmp/sim-runtime",
  });

  assert.equal(config.apiBaseUrl, "http://localhost:3000/api");
  assert.equal(config.socketUrl, "http://localhost:3000/events");
  assert.equal(config.businessId, "simulation_test");
  assert.equal(config.trafficSource, "simulation_support_v1");
  assert.equal(config.accountCount, 2);
  assert.equal(config.concurrency, 1);
  assert.equal(config.otpCode, "123456");
  assert.equal(config.runtimeDir, "/tmp/sim-runtime");
});

test("loadConfig 拒绝超过 5 的并发（安全阀）", () => {
  assert.throws(() => loadConfig({ SIM_CONCURRENCY: "6" }), /SIM_CONCURRENCY/);
});

test("loadConfig 拒绝非法账号数与 OTP 码", () => {
  assert.throws(
    () => loadConfig({ SIM_ACCOUNT_COUNT: "0" }),
    /SIM_ACCOUNT_COUNT/,
  );
  assert.throws(
    () => loadConfig({ SIM_ACCOUNT_COUNT: "abc" }),
    /SIM_ACCOUNT_COUNT/,
  );
  assert.throws(() => loadConfig({ SIM_OTP_CODE: "12" }), /SIM_OTP_CODE/);
  assert.throws(
    () => loadConfig({ SIM_API_BASE_URL: "not-a-url" }),
    /SIM_API_BASE_URL/,
  );
});

test("apiUrl 统一拼接 /v1 路径", () => {
  const config = loadConfig({});
  assert.equal(
    apiUrl(config, "/v1/otp/request"),
    `${DEFAULTS.apiBaseUrl}/v1/otp/request`,
  );
  assert.equal(
    apiUrl(config, "v1/otp/request"),
    `${DEFAULTS.apiBaseUrl}/v1/otp/request`,
  );
});
