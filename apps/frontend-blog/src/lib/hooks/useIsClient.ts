/**
 * 客户端状态检测Hook（统一解决水合问题）
 * 
 * 使用原则：所有依赖客户端状态的Class或组件，必须通过此Hook判断
 * 
 * 根据.clinerules宪法v2.0要求：
 * - 禁止产生水合错误
 * - 涉及浏览器API（window, localStorage, Canvas等）的逻辑，必须封装在`useIsClient` Hook中
 * 
 * @example
 * ```typescript
 * // ❌ 错误：直接使用浏览器API
 * const isMobile = window.innerWidth < 768;
 * 
 * // ✅ 正确：使用防御性Hook
 * const useIsMobile = () => {
 *   const isClient = useIsClient();
 *   const [isMobile, setIsMobile] = useState(false);
 *   
 *   useEffect(() => {
 *     if (isClient) {
 *       setIsMobile(window.innerWidth < 768);
 *     }
 *   }, [isClient]);
 *   
 *   return isMobile;
 * };
 * ```
 */
export function useIsClient(): boolean {
  const [isClient, setIsClient] = useState(false);
  
  useEffect(() => {
    setIsClient(true);
  }, []);
  
  return isClient;
}

/**
 * 可选依赖安全加载Hook
 * 
 * 使用原则：所有动态导入的可选依赖必须使用此Hook
 * 
 * @example
 * ```typescript
 * const capacitorPreferences = useOptionalModule<typeof import('@capacitor/preferences')>('@capacitor/preferences');
 * 
 * if (capacitorPreferences) {
 *   // 安全使用可选模块
 *   await capacitorPreferences.Preferences.set({ key: 'test', value: 'data' });
 * } else {
 *   // fallback逻辑
 *   localStorage.setItem('test', 'data');
 * }
 * ```
 */
export function useOptionalModule<T>(moduleName: string): T | null {
  const [module, setModule] = useState<T | null>(null);
  
  useEffect(() => {
    import(moduleName)
      .then(mod => setModule(mod))
      .catch(() => {
        console.warn(`Optional module ${moduleName} not available, using fallback`);
        setModule(null);
      });
  }, [moduleName]);
  
  return module;
}

/**
 * 类型安全访问Hook（防止null/undefined错误）
 * 
 * 使用原则：所有可能为null/undefined的值必须使用此Hook
 * 
 * @example
 * ```typescript
 * const user = useSafeAccess(authStore.user, defaultUser);
 * const token = useSafeAccess(authStore.accessToken, '');
 * ```
 */
export function useSafeAccess<T>(value: T | null | undefined, defaultValue: T): T {
  return value ?? defaultValue;
}

/**
 * 浏览器API安全访问Hook
 * 
 * 使用原则：所有浏览器API访问必须通过此Hook
 * 
 * @example
 * ```typescript
 * const localStorage = useBrowserAPI<Storage>('localStorage');
 * const windowWidth = useBrowserAPI<number>('window.innerWidth', 0);
 * ```
 */
export function useBrowserAPI<T>(apiPath: string, defaultValue: T): T {
  const isClient = useIsClient();
  const [value, setValue] = useState<T>(defaultValue);
  
  useEffect(() => {
    if (isClient) {
      try {
        // 安全访问嵌套属性，如 window.innerWidth
        const result = apiPath.split('.').reduce((obj, key) => obj?.[key], window as any);
        if (result !== undefined) {
          setValue(result);
        }
      } catch (error) {
        console.warn(`Browser API ${apiPath} not available:`, error);
      }
    }
  }, [isClient, apiPath]);
  
  return value;
}

/**
 * 媒体查询Hook（响应式设计）
 * 
 * 使用原则：所有媒体查询必须通过此Hook
 * 
 * @example
 * ```typescript
 * const isMobile = useMediaQuery('(max-width: 768px)');
 * const isDarkMode = useMediaQuery('(prefers-color-scheme: dark)');
 * ```
 */
export function useMediaQuery(query: string): boolean {
  const isClient = useIsClient();
  const [matches, setMatches] = useState(false);
  
  useEffect(() => {
    if (!isClient) return;
    
    const mediaQuery = window.matchMedia(query);
    setMatches(mediaQuery.matches);
    
    const handler = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };
    
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [isClient, query]);
  
  return matches;
}

/**
 * 防抖Hook
 * 
 * 使用原则：频繁触发的事件（如resize、scroll、input）必须使用防抖
 * 
 * @example
 * ```typescript
 * const [searchTerm, setSearchTerm] = useState('');
 * const debouncedSearchTerm = useDebounce(searchTerm, 500);
 * 
 * useEffect(() => {
 *   // 只在用户停止输入500ms后执行搜索
 *   if (debouncedSearchTerm) {
 *     searchArticles(debouncedSearchTerm);
 *   }
 * }, [debouncedSearchTerm]);
 * ```
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    
    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);
  
  return debouncedValue;
}

/**
 * 节流Hook
 * 
 * 使用原则：限制函数执行频率（如scroll、resize事件）
 * 
 * @example
 * ```typescript
 * const handleScroll = useThrottle(() => {
 *   // 最多每100ms执行一次
 *   updateScrollPosition();
 * }, 100);
 * 
 * useEffect(() => {
 *   window.addEventListener('scroll', handleScroll);
 *   return () => window.removeEventListener('scroll', handleScroll);
 * }, [handleScroll]);
 * ```
 */
export function useThrottle<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const lastCallRef = useRef<number>(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  return useCallback((...args: Parameters<T>) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCallRef.current;
    
    if (timeSinceLastCall >= delay) {
      lastCallRef.current = now;
      callback(...args);
    } else if (!timeoutRef.current) {
      timeoutRef.current = setTimeout(() => {
        lastCallRef.current = Date.now();
        callback(...args);
        timeoutRef.current = null;
      }, delay - timeSinceLastCall);
    }
  }, [callback, delay]) as T;
}

/**
 * 竞态条件防护Hook
 * 
 * 使用原则：所有异步操作必须考虑竞态条件
 * 
 * @example
 * ```typescript
 * const { data, loading, error } = useRaceConditionGuard(
 *   async () => {
 *     const response = await fetch(`/api/articles/${id}`);
 *     return response.json();
 *   },
 *   [id] // 依赖数组
 * );
 * ```
 */
export function useRaceConditionGuard<T>(
  asyncFunction: () => Promise<T>,
  dependencies: any[] = []
): { data: T | null; loading: boolean; error: Error | null } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);
  
  useEffect(() => {
    mountedRef.current = true;
    
    return () => {
      mountedRef.current = false;
    };
  }, []);
  
  useEffect(() => {
    let isCancelled = false;
    
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const result = await asyncFunction();
        
        if (!isCancelled && mountedRef.current) {
          setData(result);
        }
      } catch (err) {
        if (!isCancelled && mountedRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!isCancelled && mountedRef.current) {
          setLoading(false);
        }
      }
    };
    
    fetchData();
    
    return () => {
      isCancelled = true;
    };
  }, dependencies);
  
  return { data, loading, error };
}

// 导入React hooks
import { useState, useEffect, useRef, useCallback } from 'react';