/**
 * Capacitor Preferences 模块类型声明
 * 这是一个可选依赖，用于跨平台存储
 * 实际运行时可能不存在，代码有fallback机制
 */

declare module '@capacitor/preferences' {
  export interface GetOptions {
    key: string;
  }

  export interface GetResult {
    value: string | null;
  }

  export interface SetOptions {
    key: string;
    value: string;
  }

  export interface RemoveOptions {
    key: string;
  }

  export interface PreferencesPlugin {
    /**
     * 获取存储的值
     */
    get(options: GetOptions): Promise<GetResult>;

    /**
     * 设置存储的值
     */
    set(options: SetOptions): Promise<void>;

    /**
     * 删除存储的值
     */
    remove(options: RemoveOptions): Promise<void>;

    /**
     * 清除所有存储
     */
    clear(): Promise<void>;

    /**
     * 获取所有键
     */
    keys(): Promise<{ keys: string[] }>;
  }

  export const Preferences: PreferencesPlugin;
}
