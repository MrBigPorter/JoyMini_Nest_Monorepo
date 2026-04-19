/**
 * 平台服务
 * 统一平台API调用接口和特性检测
 */

import type { IPlatformAdapter } from '../types';

export interface PlatformServiceOptions {
  /** 是否启用调试日志 */
  debug?: boolean;
  /** 默认语言 */
  defaultLocale?: string;
  /** 网络超时时间（毫秒） */
  networkTimeout?: number;
}

/**
 * 平台服务
 */
export class PlatformService {
  private adapter: IPlatformAdapter;
  private options: Required<PlatformServiceOptions>;

  constructor(adapter: IPlatformAdapter, options: PlatformServiceOptions = {}) {
    this.adapter = adapter;
    this.options = {
      debug: options.debug || false,
      defaultLocale: options.defaultLocale || 'zh',
      networkTimeout: options.networkTimeout || 10000,
    };

    this.log('PlatformService initialized', {
      platform: adapter.platform,
      options: this.options,
    });
  }

  /**
   * 获取平台信息
   */
  getPlatformInfo() {
    const deviceInfo = this.adapter.device.getInfo();
    const networkStatus = this.adapter.network.getNetworkStatus();

    return {
      platform: this.adapter.platform,
      version: this.adapter.version,
      device: deviceInfo,
      network: networkStatus,
      capabilities: {
        supportsISR: false, // ISR策略已移除，直接返回false
        supportsServerActions: this.adapter.network.supportsServerActions(),
        supportsPersistentCache: this.adapter.cache.supportsPersistentCache(),
        supportsPush: this.adapter.device.supportsPush(),
        supportsCamera: this.adapter.device.supportsCamera(),
        supportsGeolocation: this.adapter.device.supportsGeolocation(),
      },
    };
  }

  /**
   * 执行网络请求（带平台适配）
   */
  async fetch<T>(
    url: string,
    options: RequestInit = {},
    cacheKey?: string,
  ): Promise<T> {
    const startTime = Date.now();

    try {
      // 执行请求
      const response = await this.executeWithTimeout(
        () => fetch(url, options),
        this.options.networkTimeout,
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      const duration = Date.now() - startTime;
      this.log('Fetch completed', { url, duration });

      return data;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.log('Fetch failed', {
        url,
        duration,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 执行平台特定的操作
   */
  async executePlatformAction<T>(
    action: (adapter: IPlatformAdapter) => Promise<T>,
    fallback?: () => Promise<T>,
  ): Promise<T> {
    try {
      return await action(this.adapter);
    } catch (error) {
      this.log('Platform action failed', {
        platform: this.adapter.platform,
        error: error instanceof Error ? error.message : String(error),
      });

      if (fallback) {
        this.log('Using fallback');
        return await fallback();
      }

      throw error;
    }
  }

  /**
   * 检查网络连接
   */
  async checkNetworkConnection(): Promise<{
    online: boolean;
    type?: string;
    latency?: number;
  }> {
    const startTime = Date.now();

    try {
      // 尝试连接一个可靠的端点
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      await fetch('https://www.google.com/favicon.ico', {
        mode: 'no-cors',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const latency = Date.now() - startTime;

      return {
        online: true,
        type: 'good',
        latency,
      };
    } catch (error) {
      return {
        online: false,
        type: 'offline',
      };
    }
  }

  /**
   * 获取设备存储信息
   */
  async getStorageInfo(): Promise<{
    total: number;
    used: number;
    available: number;
    percentUsed: number;
  }> {
    // 简化实现：检查localStorage使用情况
    if (typeof window === 'undefined') {
      return {
        total: 0,
        used: 0,
        available: 0,
        percentUsed: 0,
      };
    }

    try {
      const total = 5 * 1024 * 1024; // 假设5MB
      let used = 0;

      // 估算localStorage使用量
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          const value = localStorage.getItem(key) || '';
          used += key.length + value.length;
        }
      }

      const available = Math.max(0, total - used);
      const percentUsed = total > 0 ? (used / total) * 100 : 0;

      return {
        total,
        used,
        available,
        percentUsed,
      };
    } catch (error) {
      return {
        total: 0,
        used: 0,
        available: 0,
        percentUsed: 0,
      };
    }
  }

  /**
   * 带超时的执行
   */
  private async executeWithTimeout<T>(
    action: () => Promise<T>,
    timeout: number,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Operation timeout after ${timeout}ms`));
      }, timeout);

      action()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * 日志记录
   */
  private log(message: string, data?: unknown) {
    if (this.options.debug) {
      this.adapter.logger.info(`[PlatformService] ${message}`, data);
    }
  }
}
