import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

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
}

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
      user: null,
      accessToken: null,
      refreshToken: null,
      isLoading: false,
      isHydrated: false,

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

        set({
          ...tokens,
          user,
          isHydrated: true,
        });

        console.log('Auth store: login successful, state updated');

        // 验证状态是否已设置
        setTimeout(() => {
          const currentState = get();
          console.log('Auth store: After login state check', {
            hasToken: !!currentState.accessToken,
            hasUser: !!currentState.user,
            isHydrated: currentState.isHydrated,
          });

          // 检查localStorage是否已更新
          if (typeof window !== 'undefined') {
            try {
              const stored = localStorage.getItem('auth-storage');
              if (stored) {
                console.log(
                  'Auth store: localStorage after login:',
                  stored.substring(0, 200),
                );
              } else {
                console.log('Auth store: No data in localStorage after login');
              }
            } catch (error) {
              console.error('Auth store: Failed to check localStorage:', error);
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
        });
      },

      setTokens: (tokens) => {
        console.log('Auth store: setTokens called', tokens);
        set({ ...tokens });
      },

      setUser: (user) => {
        console.log('Auth store: setUser called', user);
        set({ user });
      },

      setLoading: (loading) => set({ isLoading: loading }),

      setHydrated: () => {
        console.log('Auth store: setHydrated called');
        set({ isHydrated: true });
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
      // 只存储必要的字段
      partialize: (state) => {
        console.log('Auth store: partialize called with state', {
          hasAccessToken: !!state.accessToken,
          hasRefreshToken: !!state.refreshToken,
          hasUser: !!state.user,
          accessTokenLength: state.accessToken?.length || 0,
          userId: state.user?.id,
        });
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
        console.log(
          'Auth store: onRehydrateStorage called, state present:',
          !!state,
        );

        // Always ensure hydration is marked as complete
        // This prevents components from waiting forever
        const ensureHydration = () => {
          if (state) {
            console.log('Auth store: Setting hydrated from stored state');
            state.setHydrated();
          } else {
            // If no state from storage, we're still hydrated (just with null values)
            console.log(
              'Auth store: No stored state, marking as hydrated anyway',
            );
            // Use setTimeout to avoid React batching issues
            setTimeout(() => {
              const currentState = useAuthStore.getState();
              if (!currentState.isHydrated) {
                currentState.setHydrated();
              }
            }, 0);
          }
        };

        ensureHydration();
      },
    },
  ),
);

// 在客户端初始化时确保水合状态
if (typeof window !== 'undefined') {
  // 检查store是否已经水合，如果没有则手动设置
  const checkAndSetHydration = () => {
    const state = useAuthStore.getState();
    if (!state.isHydrated) {
      console.log('Auth store: manually setting hydration on client init');
      useAuthStore.getState().setHydrated();
    }
  };

  // 延迟执行，确保组件能观察到状态变化
  setTimeout(checkAndSetHydration, 0);
}
