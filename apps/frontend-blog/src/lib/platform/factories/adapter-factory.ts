/**
 * 平台适配器工厂
 * 负责创建和管理平台适配器实例
 */

import type { IPlatformAdapter, PlatformType } from '../types';
import { detectPlatform } from '../detectors/runtime.detector';
import { createWebAdapter } from '../adapters/web.adapter';
import { createH5Adapter } from '../adapters/h5.adapter';
import { createCapacitorAdapter } from '../adapters/capacitor.adapter';
import { createServerAdapter } from '../adapters/server.adapter';

/** 适配器实例缓存 */
const adapterCache = new Map<PlatformType, IPlatformAdapter>();

/**
 * 获取当前平台的适配器
 */
export function getPlatformAdapter(): IPlatformAdapter {
  const platform = detectPlatform();
  
  // 检查缓存
  if (adapterCache.has(platform)) {
    return adapterCache.get(platform)!;
  }
  
  // 创建适配器
  let adapter: IPlatformAdapter;
  
  switch (platform) {
    case 'web':
      adapter = createWebAdapter();
      break;
    case 'h5':
      adapter = createH5Adapter();
      break;
    case 'capacitor':
      adapter = createCapacitorAdapter();
      break;
    case 'server':
      adapter = createServerAdapter();
      break;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
  
  // 缓存适配器
  adapterCache.set(platform, adapter);
  
  return adapter;
}

/**
 * 清除适配器缓存（用于测试）
 */
export function clearAdapterCache(): void {
  adapterCache.clear();
}

// ================= 导出 =================

// 注意：函数已经在顶部声明为export，这里不需要重复导出
