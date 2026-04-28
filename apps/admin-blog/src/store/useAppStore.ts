import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Theme, Language } from '../type/types';
import { AVAILABLE_LOCALES, DEFAULT_LOCALE } from '@lucky/shared';

interface AppState {
  theme: Theme;
  lang: Language;
  isSidebarCollapsed: boolean;
  toggleTheme: () => void;
  toggleLang: () => void;
  setLang: (lang: Language) => void;
  toggleSidebar: () => void;
}

export const useAppStore = create<AppState>()(
  persist<AppState>(
    (set) => ({
      theme: 'dark',
      lang: DEFAULT_LOCALE,
      isSidebarCollapsed: false,
      toggleTheme: () =>
        set((state) => {
          const newTheme = state.theme === 'dark' ? 'light' : 'dark';
          if (typeof document !== 'undefined') {
            document.documentElement.classList.remove('dark', 'light');
            document.documentElement.classList.add(newTheme);
          }
          return { theme: newTheme };
        }),
      toggleLang: () =>
        set((state) => {
          const currentIndex = AVAILABLE_LOCALES.indexOf(state.lang);
          const nextIndex = (currentIndex + 1) % AVAILABLE_LOCALES.length;
          return { lang: AVAILABLE_LOCALES[nextIndex] };
        }),
      setLang: (lang: Language) => set({ lang }),
      toggleSidebar: () =>
        set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
    }),
    {
      name: 'app-store', // localStorage key
      storage: createJSONStorage(() => {
        // SSR 安全：服务端没有 localStorage，返回空实现
        if (typeof window === 'undefined') {
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          };
        }
        return localStorage;
      }),
      // 持久化 theme、lang 和 isSidebarCollapsed
      partialize: (state) =>
        ({
          theme: state.theme,
          lang: state.lang,
          isSidebarCollapsed: state.isSidebarCollapsed,
        }) as unknown as AppState,
    },
  ),
);
