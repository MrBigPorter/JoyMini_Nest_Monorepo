import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { supportsSyncRead } from '@/lib/utils/platform';
import { cookieStorage } from './cookie-storage';

export interface User {
  id: string;
  phone: string;
  phoneMd5: string;
  nickname: string;
  avatar: string | null;
  email: string;
  inviteCode: string | null;
  vipLevel: number;
  lastLoginAt: number | null;
  kycStatus: string;
  selfExclusionExpireAt: number;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoading: boolean;
  isHydrated: boolean;
  _synced: boolean; // 新增：同步状态标志

  // Actions
  login: (
    tokens: { accessToken: string; refreshToken: string },
    user: User,
  ) => void;
  logout: () => void;
  setTokens: (tokens: { accessToken: string; refreshToken: string }) => void;
  setUser: (user: User) => void;
  setLoading: (loading: boolean) => void;
  setHydrated: () => void;

  // 新增：同步初始化方法
  syncFromStorage: () => void;

  // 计算属性（改为方法，避免 Zustand 类型问题）
  isAuthenticated: () => boolean;
}

// 明确定义初始状态类型（遵循模板E的最佳实践）
const initialState: AuthState = {
  user: null,
  accessToken: null,
  refreshToken: null,
  isLoading: false,
  isHydrated: false,
  _synced: false,
  login: () => {},
  logout: () => {},
  setTokens: () => {},
  setUser: () => {},
  setLoading: () => {},
  setHydrated: () => {},
  syncFromStorage: () => {},
  isAuthenticated: () => false,
};

// 创建一个简单的迁移函数来处理旧数据格式
const migrateAuthState = (persistedState: any): Partial<AuthState> => {
  console.log('Auth store: migrate called with:', persistedState);

  // 情况1：已经是正确的格式
  if (persistedState && 'accessToken' in persistedState) {
    console.log('Auth store: case 1 - correct format');
    return persistedState;
  }

  // 情况2：有state包装的格式（旧格式）
  if (persistedState?.state) {
    console.log('Auth store: case 2 - state wrapped format');
    return persistedState.state;
  }

  // 情况3：无数据
  console.log('Auth store: case 3 - no data');
  return {
    user: null,
    accessToken: null,
    refreshToken: null,
  };
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // 使用明确的类型标注，避免类型推导错误
      user: initialState.user,
      accessToken: initialState.accessToken,
      refreshToken: initialState.refreshToken,
      isLoading: initialState.isLoading,
      isHydrated: initialState.isHydrated,
      _synced: initialState._synced,

      login: (tokens, user) => {
        console.log('Auth store: login called', { tokens, user });

        // Validate tokens and user before setting state
        if (!tokens?.accessToken || !tokens?.refreshToken) {
          console.error('Auth store: Invalid tokens provided to login', tokens);
          throw new Error('Invalid tokens provided to login');
        }

        if (!user || !user.id) {
          console.error('Auth store: Invalid user provided to login', user);
          throw new Error('Invalid user provided to login');
        }

        // 设置Zustand状态
        set({
          ...tokens,
          user,
          isHydrated: true,
          _synced: true,
        });

        console.log('Auth store: login successful, state updated');

        // 验证状态是否已设置
        setTimeout(() => {
          const currentState = get();
          console.log('Auth store: After login state check', {
            hasToken: !!currentState.accessToken,
            hasUser: !!currentState.user,
            isHydrated: currentState.isHydrated,
            isSynced: currentState._synced,
          });

          // 检查Cookie是否已更新
          if (typeof window !== 'undefined') {
            try {
              const token = cookieStorage.getItem('auth-storage');
              if (token && typeof token === 'string') {
                console.log(
                  'Auth store: Cookie after login:',
                  token.substring(0, 200),
                );
              } else if (token instanceof Promise) {
                // 如果是Promise，等待它完成
                token
                  .then((value) => {
                    if (value) {
                      console.log(
                        'Auth store: Cookie after login (async):',
                        value.substring(0, 200),
                      );
                    } else {
                      console.log(
                        'Auth store: No data in Cookie after login (async)',
                      );
                    }
                  })
                  .catch((error) => {
                    console.error(
                      'Auth store: Failed to check Cookie (async):',
                      error,
                    );
                  });
              } else {
                console.log('Auth store: No data in Cookie after login');
              }
            } catch (error) {
              console.error('Auth store: Failed to check Cookie:', error);
            }
          }
        }, 100);
      },

      logout: () => {
        console.log('Auth store: logout called');

        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          _synced: true,
        });
      },

      setTokens: (tokens) => {
        console.log('Auth store: setTokens called', tokens);

        set({ ...tokens, _synced: true });
      },

      setUser: (user) => {
        set({ user, _synced: true });
      },

      setLoading: (loading) => set({ isLoading: loading }),

      setHydrated: () => {
        set({ isHydrated: true, _synced: true });
      },

      // 新增：同步读取存储
      syncFromStorage: () => {
        if (typeof window === 'undefined') return;

        // 如果已经同步过，跳过
        if (get()._synced) return;

        try {
          // 从Cookie存储读取数据
          const raw = cookieStorage.getItem('auth-storage');

          const handleRawData = (data: string | null) => {
            if (!data) {
              set({ _synced: true });
              return;
            }

            const parsed = JSON.parse(data);
            console.log('Auth store: syncFromStorage parsed:', {
              hasToken: !!parsed.state?.accessToken,
              hasUser: !!parsed.state?.user,
            });

            // 立即设置状态，不等待异步水合
            set({
              accessToken: parsed.state?.accessToken || null,
              refreshToken: parsed.state?.refreshToken || null,
              user: parsed.state?.user || null,
              _synced: true,
            });

            console.log('Auth store: syncFromStorage completed');
          };

          if (raw instanceof Promise) {
            // 如果是Promise，等待它完成
            raw.then(handleRawData).catch((error) => {
              console.error(
                'Auth store: Failed to sync from storage (async):',
                error,
              );
              set({ _synced: true });
            });
          } else {
            // 如果是同步数据，直接处理
            handleRawData(raw);
          }
        } catch (error) {
          console.error('Auth store: Failed to sync from storage:', error);
          set({ _synced: true });
        }
      },

      // 计算属性：认证状态（改为方法）
      isAuthenticated: () => {
        const state = get();
        return !!(state.accessToken && state.user);
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => cookieStorage),
      // 只存储必要的字段
      partialize: (state) => {
        return {
          accessToken: state.accessToken,
          refreshToken: state.refreshToken,
          user: state.user,
        };
      },
      // 使用迁移函数
      migrate: migrateAuthState,
      // 水合完成后设置isHydrated
      onRehydrateStorage: () => (state) => {
        // Always ensure hydration is marked as complete
        // This prevents components from waiting forever
        const ensureHydration = () => {
          if (state) {
            state.setHydrated();
            state._synced = true;
          } else {
            // Use setTimeout to avoid React batching issues
            setTimeout(() => {
              const currentState = useAuthStore.getState();
              if (!currentState.isHydrated) {
                currentState.setHydrated();
              }
              if (!currentState._synced) {
                currentState._synced = true;
              }
            }, 0);
          }
        };

        ensureHydration();
      },
    },
  ),
);

// 在客户端初始化时确保水合状态和同步
if (typeof window !== 'undefined') {
  // 立即同步读取存储（如果支持）
  if (supportsSyncRead()) {
    console.log('Auth store: Performing initial sync from storage');
    useAuthStore.getState().syncFromStorage();
  }

  // 检查store是否已经水合，如果没有则手动设置
  const checkAndSetHydration = () => {
    const state = useAuthStore.getState();
    if (!state.isHydrated) {
      useAuthStore.getState().setHydrated();
    }
    if (!state._synced) {
      useAuthStore.getState()._synced = true;
    }
  };

  // 延迟执行，确保组件能观察到状态变化
  setTimeout(checkAndSetHydration, 0);
}
