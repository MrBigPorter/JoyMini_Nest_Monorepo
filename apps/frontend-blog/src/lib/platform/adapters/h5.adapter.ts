/**
 * H5平台适配器
 * 适用于移动端Web浏览器环境（SSG/CSR）
 */

import type { IPlatformAdapter } from '../types';
import { createWebAdapter } from './web.adapter';

/**
 * 创建H5平台适配器
 */
export function createH5Adapter(): IPlatformAdapter {
  const webAdapter = createWebAdapter();

  return {
    ...webAdapter,
    platform: 'h5',
    version: '1.0.0',

    query: {
      ...webAdapter.query,
      buildQueryKey: (baseKey) => ['h5', ...baseKey],
      getStaleTime: () => 30 * 1000, // H5端缓存时间更短
      getGcTime: () => 3 * 60 * 1000, // 3分钟
    },

    device: {
      ...webAdapter.device,
      getInfo: () => {
        const info = webAdapter.device.getInfo();
        return {
          ...info,
          platform: 'h5' as const,
        };
      },
    },

    logger: {
      info: (message: string, data?: unknown) => {
        console.log(`[H5 Platform] ${message}`, data || '');
      },
      warn: (message: string, data?: unknown) => {
        console.warn(`[H5 Platform] ${message}`, data || '');
      },
      error: (message: string, data?: unknown) => {
        console.error(`[H5 Platform] ${message}`, data || '');
      },
      debug: (message: string, data?: unknown) => {
        console.debug(`[H5 Platform] ${message}`, data || '');
      },
    },
  };
}
