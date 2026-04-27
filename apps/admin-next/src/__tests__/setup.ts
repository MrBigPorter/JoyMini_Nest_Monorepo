import '@testing-library/jest-dom';
import { vi } from 'vitest';

// ── 模拟 localStorage ────────────────────────────────────────────
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// ── 模拟 matchMedia (Tailwind dark mode) ─────────────────────────
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// ── 静默 console.warn/error (axios 等库的冗余输出) ────────────────
vi.spyOn(console, 'warn').mockImplementation(() => {});

// ── 全局模拟 next-intl ───────────────────────────────────────────
// 所有使用 useTranslation() 的组件在测试中都不需要 NextIntlClientProvider 上下文
vi.mock('next-intl', () => import('./mocks/next-intl'));
