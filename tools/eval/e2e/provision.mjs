/**
 * 真实账号池：复用 tools/simulator 的 OTP 建号流程，但账号落在
 * tools/eval/e2e/.runtime/（独立目录，避免与模拟器账号互相污染）。
 *
 * 安全：只打印脱敏手机号；accounts.json 目录 700、文件 600。
 */
import fs from "node:fs";
import path from "node:path";

import {
  USER_AGENT,
  createDeviceId,
  loadAccounts,
  maskPhone,
  provisionAccounts,
  refreshAccountToken,
  saveAccounts,
} from "../../simulator/provision.mjs";
import { readBackendEnv } from "./admin.mjs";
import { E2EHttpError, requestJson } from "./http.mjs";

export { loadAccounts, saveAccounts, refreshAccountToken, maskPhone };

const PROFILE_ROUTE = "/v1/auth/profile";

/**
 * dev 的固定 OTP 码可能被容器覆盖（OTP_FIXED_CODE / OTP_DEV_CODE），
 * 不能写死 999999。显式传了 E2E_OTP_CODE 就以它为准；否则读后端容器的
 * 非敏感配置。只打印位数，不打印码值。
 */
export function resolveOtpCode(config, { env = process.env, logger = console } = {}) {
  if (env.E2E_OTP_CODE) return config.otpCode;
  const code = readBackendEnv("OTP_FIXED_CODE") ?? readBackendEnv("OTP_DEV_CODE");
  if (code && /^\d{4,8}$/.test(code)) {
    if (code !== config.otpCode) {
      logger.log?.(`OTP 固定码改用后端容器配置（${code.length} 位）`);
    }
    return code;
  }
  return config.otpCode;
}

/** 账号池文件是否已经在磁盘上（报告里用来标注复用 vs 新建）。 */
export function accountsFile(config) {
  return path.join(config.runtimeDir, "accounts.json");
}

/**
 * 用 /v1/auth/profile 校验 token；401 时用 refreshToken 换一次。
 * 刷新成功返回新账号对象（调用方负责落盘），永久失效返回 null。
 */
export async function verifyAccount(config, account, { fetchImpl } = {}) {
  try {
    await requestJson({
      config,
      route: PROFILE_ROUTE,
      token: account.token,
      deviceId: account.deviceId,
      fetchImpl,
      timeoutMs: 15_000,
    });
    return account;
  } catch (error) {
    if (!(error instanceof E2EHttpError) || error.status !== 401) {
      throw error;
    }
  }

  try {
    return await refreshAccountToken(config, account, { fetchImpl });
  } catch {
    return null;
  }
}

/**
 * 保证账号池至少有 config.accountCount 个可用账号。
 *
 * - 已有的先校验/刷新，能用的直接复用；
 * - 不够就按 OTP 流程新建（每批 5 个，中间等 60 秒防 OTP 限流）；
 * - 每新建一个立刻原子落盘，进程中断也不会丢掉已建账号。
 */
export async function ensureAccounts(config, { logger = console, fetchImpl } = {}) {
  const existing = loadAccounts(config.runtimeDir);
  const usable = [];
  const dropped = [];

  for (const account of existing) {
    const verified = await verifyAccount(config, account, { fetchImpl });
    if (verified) usable.push(verified);
    else dropped.push(account);
  }

  if (dropped.length > 0) {
    logger.warn(
      `账号池有 ${dropped.length} 个账号已失效（refresh 也失败），将移出：` +
        dropped.map((item) => maskPhone(item.phone)).join(", "),
    );
  }

  if (usable.length !== existing.length || usable.some((a, i) => a !== existing[i])) {
    saveAccounts(config.runtimeDir, usable);
  }

  if (usable.length >= config.accountCount) {
    return { accounts: usable.slice(0, config.accountCount), created: 0, reused: usable.length };
  }

  const need = config.accountCount - usable.length;
  logger.log(
    `账号池现有 ${usable.length} 个可用，需要新建 ${need} 个（${config.accountCount} 总量）`,
  );

  const excludePhones = new Set(usable.map((account) => account.phone));
  let created = 0;
  const accounts = [...usable];

  await provisionAccounts({
    count: need,
    startIndex: usable.length,
    config: { ...simulatorConfig(config), otpCode: resolveOtpCode(config, { logger }) },
    fetchImpl,
    logger,
    excludePhones,
    onAccount: async (account) => {
      created += 1;
      accounts.push(account);
      saveAccounts(config.runtimeDir, accounts);
    },
  });

  return { accounts, created, reused: usable.length };
}

/**
 * 模拟器 provisioning 只认它自己的 config 字段；这里做一次显式映射，
 * 避免两套配置对象悄悄漂移。
 */
export function simulatorConfig(config) {
  return {
    apiBaseUrl: config.apiBaseUrl,
    socketUrl: config.socketUrl,
    businessId: config.businessId,
    trafficSource: config.trafficSource,
    otpCode: config.otpCode,
  };
}

/** 账号文件是否已存在（报告里标注本次是新建还是复用）。 */
export function hasAccountsFile(config) {
  return fs.existsSync(accountsFile(config));
}

/** 只给测试用的设备号生成器（与模拟器同一实现，方便对账）。 */
export { createDeviceId, USER_AGENT };
