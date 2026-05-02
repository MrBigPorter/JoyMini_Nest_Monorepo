'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type { FrontendArticle } from '@/lib/types/frontend-blog';

// ──────────────────────────────────────────────────
// Context type
// ──────────────────────────────────────────────────
interface HomePageState {
  /** Accumulated articles across all loaded pages */
  allArticles: FrontendArticle[];
  /** Current page number (for Load More) */
  page: number;
  /** Whether we're still on the SSR-initial category */
  isInitialCategory: boolean;

  setAllArticles: React.Dispatch<React.SetStateAction<FrontendArticle[]>>;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  setIsInitialCategory: (v: boolean) => void;

  /** Reset to initial values (category switch) */
  resetState: () => void;
}

const HomePageContext = createContext<HomePageState | undefined>(undefined);

// ──────────────────────────────────────────────────
// Provider — lives inside [locale]/layout.tsx,
// persists across home ↔ article-detail navigation
// ──────────────────────────────────────────────────
export function HomePageStateProvider({ children }: { children: ReactNode }) {
  const [allArticles, setAllArticles] = useState<FrontendArticle[]>([]);
  const [page, setPage] = useState(1);
  const [isInitialCategory, setIsInitialCategory] = useState(true);

  const resetState = useCallback(() => {
    setAllArticles([]);
    setPage(1);
    setIsInitialCategory(false);
  }, []);

  return (
    <HomePageContext.Provider
      value={{
        allArticles,
        page,
        isInitialCategory,
        setAllArticles,
        setPage,
        setIsInitialCategory,
        resetState,
      }}
    >
      {children}
    </HomePageContext.Provider>
  );
}

// ──────────────────────────────────────────────────
// Hook for consumers
// ──────────────────────────────────────────────────
export function useHomePageContext(): HomePageState {
  const ctx = useContext(HomePageContext);
  if (!ctx) {
    throw new Error(
      'useHomePageContext must be used within a HomePageStateProvider',
    );
  }
  return ctx;
}
