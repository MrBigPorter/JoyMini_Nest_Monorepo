'use client';

import { useEffect, useState, createContext, useContext } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * 手动主题控制 Provider
 * 替代 next-themes，避免 hydration 问题
 * 借鉴 admin-next 的成功模式
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');
  const [isMounted, setIsMounted] = useState(false);

  // 初始化主题
  useEffect(() => {
    setIsMounted(true);

    // 从 localStorage 读取主题
    const savedTheme = localStorage.getItem('theme') as Theme | null;
    const initialTheme = savedTheme || 'dark';

    setThemeState(initialTheme);
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(initialTheme);
  }, []);

  // 应用主题到 document
  useEffect(() => {
    if (!isMounted) return;

    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
    localStorage.setItem('theme', theme);
  }, [theme, isMounted]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  const toggleTheme = () => {
    setThemeState((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  // 关键修复：始终提供 ThemeContext，即使在 SSR 期间
  // 在 SSR 期间使用默认值 'light'，避免 hydration 错误
  const contextValue = {
    theme: isMounted ? theme : 'dark', // SSR 期间使用默认值
    toggleTheme: isMounted ? toggleTheme : () => {}, // SSR 期间使用空函数
    setTheme: isMounted ? setTheme : () => {}, // SSR 期间使用空函数
  };

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * 使用主题的 Hook
 */
export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
