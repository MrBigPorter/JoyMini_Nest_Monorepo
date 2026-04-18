/**
 * 平台检测工具
 * 用于检测运行时环境，支持跨平台认证策略选择
 */

export const isServer = typeof window === 'undefined';
export const isClient = !isServer;
export const isCapacitor = isClient && 'Capacitor' in window;

/**
 * 检测是否使用 SSR
 * 在客户端检查是否有 SSR 渲染的标记
 */
export const isSSR = () => {
  if (isServer) return true;
  // 在客户端，检查是否有 hydration 数据
  return !!document.querySelector('[data-ssr]');
};

/**
 * 检测是否使用 SPA 模式
 */
export const isSPA = () => {
  if (isServer) return false;
  return !document.querySelector('[data-ssr]');
};

/**
 * 获取当前平台信息
 */
export const usePlatform = () => {
  return {
    isServer,
    isClient,
    isCapacitor,
    isSSR: isSSR(),
    isSPA: isSPA(),
    platform: isCapacitor ? 'capacitor' : isServer ? 'server' : 'web',
  };
};

/**
 * 平台特定的存储适配器
 *
 * 根据.clinerules宪法v2.0要求：
 * - 可选依赖必须正确处理
 * - 动态导入必须有类型声明
 * - 必须有fallback机制
 */
export const getPlatformStorage = () => {
  if (isServer) {
    return {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
  }

  if (isCapacitor) {
    // Capacitor 使用原生存储（动态导入，避免编译错误）
    // 使用安全的动态导入模式，符合.clinerules宪法要求
    return {
      getItem: async (key: string): Promise<string | null> => {
        // 双重检查：确保在客户端且capacitor环境下
        if (!isClient || !isCapacitor) {
          return localStorage.getItem(key);
        }

        try {
          // 使用类型安全的动态导入
          const { Preferences } = await import('@capacitor/preferences');
          const { value } = await Preferences.get({ key });
          return value;
        } catch (error) {
          console.warn(
            'Capacitor Preferences not available, falling back to localStorage:',
            error,
          );
          return localStorage.getItem(key);
        }
      },
      setItem: async (key: string, value: string): Promise<void> => {
        // 双重检查：确保在客户端且capacitor环境下
        if (!isClient || !isCapacitor) {
          localStorage.setItem(key, value);
          return;
        }

        try {
          const { Preferences } = await import('@capacitor/preferences');
          await Preferences.set({ key, value });
        } catch (error) {
          console.warn(
            'Capacitor Preferences not available, falling back to localStorage:',
            error,
          );
          localStorage.setItem(key, value);
        }
      },
      removeItem: async (key: string): Promise<void> => {
        // 双重检查：确保在客户端且capacitor环境下
        if (!isClient || !isCapacitor) {
          localStorage.removeItem(key);
          return;
        }

        try {
          const { Preferences } = await import('@capacitor/preferences');
          await Preferences.remove({ key });
        } catch (error) {
          console.warn(
            'Capacitor Preferences not available, falling back to localStorage:',
            error,
          );
          localStorage.removeItem(key);
        }
      },
    };
  }

  // 默认使用 localStorage
  return {
    getItem: (key: string): string | null => localStorage.getItem(key),
    setItem: (key: string, value: string): void =>
      localStorage.setItem(key, value),
    removeItem: (key: string): void => localStorage.removeItem(key),
  };
};

/**
 * 检查是否支持同步读取
 * 在支持的环境中，可以立即读取存储而不等待异步水合
 */
export const supportsSyncRead = () => {
  if (isServer) return false;
  if (isCapacitor) return false; // Capacitor 存储是异步的
  return true; // Web 环境支持同步读取 localStorage
};

/**
 * 平台特定的初始化逻辑
 */
export const platformInit = () => {
  if (isClient) {
    // 在客户端添加 SSR 标记检测
    if (document.querySelector('[data-ssr]')) {
      console.log('Platform: SSR mode detected');
    } else {
      console.log('Platform: SPA mode detected');
    }

    if (isCapacitor) {
      console.log('Platform: Capacitor App detected');
    }
  }
};

// 自动初始化
if (isClient) {
  platformInit();
}
