/**
 * Capacitor App平台适配器
 * 适用于原生App打包环境
 */

import type { IPlatformAdapter } from '../types';
import { createWebAdapter } from './web.adapter';

/**
 * 创建Capacitor App平台适配器
 */
export function createCapacitorAdapter(): IPlatformAdapter {
  const webAdapter = createWebAdapter();

  return {
    ...webAdapter,
    platform: 'capacitor',
    version: '1.0.0',

    query: {
      ...webAdapter.query,
      buildQueryKey: (baseKey) => ['capacitor', ...baseKey],
      getStaleTime: () => 2 * 60 * 1000, // 2分钟
      getGcTime: () => 10 * 60 * 1000, // 10分钟
      supportsBackgroundRefetch: () => false, // App端后台刷新有限制
    },

    network: {
      ...webAdapter.network,
      supportsServerActions: () => false, // App端不支持Server Actions
    },

    cache: {
      ...webAdapter.cache,
      supportsPersistentCache: () => true, // App端支持持久化缓存
    },

    device: {
      ...webAdapter.device,
      getInfo: () => {
        const info = webAdapter.device.getInfo();
        return {
          ...info,
          platform: 'capacitor' as const,
        };
      },
      supportsPush: () => true, // App端支持推送
      supportsCamera: () => true, // App端支持相机
      supportsGeolocation: () => true, // App端支持地理位置
    },

    logger: {
      info: (message: string, data?: unknown) => {
        console.log(`[Capacitor Platform] ${message}`, data || '');
      },
      warn: (message: string, data?: unknown) => {
        console.warn(`[Capacitor Platform] ${message}`, data || '');
      },
      error: (message: string, data?: unknown) => {
        console.error(`[Capacitor Platform] ${message}`, data || '');
      },
      debug: (message: string, data?: unknown) => {
        console.debug(`[Capacitor Platform] ${message}`, data || '');
      },
    },
  };
}
