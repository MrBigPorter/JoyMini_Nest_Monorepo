import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useAppStore } from '@/store/useAppStore';

beforeEach(() => {
  useAppStore.setState({
    theme: 'dark',
    lang: 'en',
    isSidebarCollapsed: false,
  });
  document.documentElement.className = '';
});

describe('useAppStore', () => {
  describe('toggleTheme', () => {
    it('dark → light', () => {
      act(() => {
        useAppStore.getState().toggleTheme();
      });
      expect(useAppStore.getState().theme).toBe('light');
      expect(document.documentElement.classList.contains('light')).toBe(true);
    });

    it('light → dark', () => {
      useAppStore.setState({ theme: 'light' });
      act(() => {
        useAppStore.getState().toggleTheme();
      });
      expect(useAppStore.getState().theme).toBe('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
  });

  describe('toggleLang', () => {
    it('en → ja', () => {
      act(() => {
        useAppStore.getState().toggleLang();
      });
      expect(useAppStore.getState().lang).toBe('ja');
    });

    it('zh → en', () => {
      useAppStore.setState({ lang: 'zh' });
      act(() => {
        useAppStore.getState().toggleLang();
      });
      expect(useAppStore.getState().lang).toBe('en');
    });
  });

  describe('toggleSidebar', () => {
    it('展开 → 折叠', () => {
      act(() => {
        useAppStore.getState().toggleSidebar();
      });
      expect(useAppStore.getState().isSidebarCollapsed).toBe(true);
    });

    it('折叠 → 展开', () => {
      useAppStore.setState({ isSidebarCollapsed: true });
      act(() => {
        useAppStore.getState().toggleSidebar();
      });
      expect(useAppStore.getState().isSidebarCollapsed).toBe(false);
    });
  });
});
