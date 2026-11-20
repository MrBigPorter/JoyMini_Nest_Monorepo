import path from "node:path";
import { fileURLToPath } from "node:url";

/** tools/simulator 的绝对路径，用于把运行态文件固定在仓库内的 .runtime/。 */
export const SIMULATOR_DIR = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULTS = Object.freeze({
  apiBaseUrl: "https://api.joyminis.com/api",
  socketUrl: "https://api.joyminis.com/events",
  businessId: "simulation_support_v1",
  accountCount: 30,
  concurrency: 5,
  otpCode: "999999",
});

/** 安全阀：P0 计划规定 5 并发；账号池首批 30。 */
const MAX_CONCURRENCY = 5;
const MAX_ACCOUNT_COUNT = 100;

function parseInteger(env, key, fallback, { min, max }) {
  const raw = env[key];
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return fallback;
  }
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`${key} must be an integer, got "${text}"`);
  }
  const value = Number(text);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be between ${min} and ${max}, got ${value}`);
  }
  return value;
}

function parseHttpUrl(value, fallback, key) {
  const text = String(value ?? fallback)
    .trim()
    .replace(/\/+$/, "");
  if (!/^https?:\/\/[^/\s]+/i.test(text)) {
    throw new Error(`${key} must be an http(s) URL, got "${text}"`);
  }
  return text;
}

function parseNonEmpty(value, fallback, key) {
  const text = String(value ?? fallback).trim();
  if (!text) throw new Error(`${key} must not be empty`);
  return text;
}

/**
 * 读取模拟器配置。所有值都可以用 env 覆盖，默认指向生产专用渠道。
 * 注意：这里不读 .env 文件，避免与部署环境产生隐式耦合。
 */
export function loadConfig(env = process.env) {
  const apiBaseUrl = parseHttpUrl(
    env.SIM_API_BASE_URL,
    DEFAULTS.apiBaseUrl,
    "SIM_API_BASE_URL",
  );
  const socketUrl = parseHttpUrl(
    env.SIM_SOCKET_URL,
    DEFAULTS.socketUrl,
    "SIM_SOCKET_URL",
  );
  const businessId = parseNonEmpty(
    env.SIM_BUSINESS_ID,
    DEFAULTS.businessId,
    "SIM_BUSINESS_ID",
  );
  const accountCount = parseInteger(
    env,
    "SIM_ACCOUNT_COUNT",
    DEFAULTS.accountCount,
    { min: 1, max: MAX_ACCOUNT_COUNT },
  );
  const concurrency = parseInteger(
    env,
    "SIM_CONCURRENCY",
    DEFAULTS.concurrency,
    { min: 1, max: MAX_CONCURRENCY },
  );
  const otpCode = parseNonEmpty(
    env.SIM_OTP_CODE,
    DEFAULTS.otpCode,
    "SIM_OTP_CODE",
  );
  if (!/^\d{4,8}$/.test(otpCode)) {
    throw new Error(`SIM_OTP_CODE must be 4-8 digits, got "${otpCode}"`);
  }

  const runtimeDir = env.SIM_RUNTIME_DIR
    ? path.resolve(String(env.SIM_RUNTIME_DIR).trim())
    : path.join(SIMULATOR_DIR, ".runtime");

  return {
    apiBaseUrl,
    socketUrl,
    businessId,
    accountCount,
    concurrency,
    otpCode,
    runtimeDir,
  };
}

/** 把 `/v1/...` 路径拼到 apiBaseUrl（默认已包含 `/api`）后面。 */
export function apiUrl(config, pathname) {
  const base = String(config.apiBaseUrl).replace(/\/+$/, "");
  const suffix = String(pathname).startsWith("/") ? pathname : `/${pathname}`;
  return `${base}${suffix}`;
}
