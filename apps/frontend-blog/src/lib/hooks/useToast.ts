'use client';

import {
  useState,
  useCallback,
  createContext,
  useContext,
  ReactNode,
  createElement,
} from 'react';

export interface ToastOptions {
  type?: 'success' | 'error' | 'warning' | 'info';
  duration?: number;
  title?: string;
}

interface ToastItem {
  id: string;
  message: string;
  options: ToastOptions;
  visible: boolean;
}

interface ToastContextType {
  toasts: ToastItem[];
  show: (message: string, options?: ToastOptions) => string;
  success: (message: string, options?: Omit<ToastOptions, 'type'>) => string;
  error: (message: string, options?: Omit<ToastOptions, 'type'>) => string;
  warning: (message: string, options?: Omit<ToastOptions, 'type'>) => string;
  info: (message: string, options?: Omit<ToastOptions, 'type'>) => string;
  hide: (id: string) => void;
  remove: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const show = useCallback((message: string, options: ToastOptions = {}) => {
    const id = Math.random().toString(36).substr(2, 9);
    const toast: ToastItem = {
      id,
      message,
      options: { type: 'info', duration: 3000, ...options },
      visible: true,
    };

    setToasts((prev) => [...prev, toast]);

    setTimeout(() => {
      setToasts((prev) =>
        prev.map((t) => (t.id === id ? { ...t, visible: false } : t)),
      );
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 300);
    }, toast.options.duration);

    return id;
  }, []);

  const success = useCallback(
    (message: string, options?: Omit<ToastOptions, 'type'>) => {
      return show(message, { ...options, type: 'success' });
    },
    [show],
  );

  const error = useCallback(
    (message: string, options?: Omit<ToastOptions, 'type'>) => {
      return show(message, { ...options, type: 'error', duration: 5000 });
    },
    [show],
  );

  const warning = useCallback(
    (message: string, options?: Omit<ToastOptions, 'type'>) => {
      return show(message, { ...options, type: 'warning' });
    },
    [show],
  );

  const info = useCallback(
    (message: string, options?: Omit<ToastOptions, 'type'>) => {
      return show(message, { ...options, type: 'info' });
    },
    [show],
  );

  const hide = useCallback((id: string) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, visible: false } : t)),
    );
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 300);
  }, []);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return createElement(
    ToastContext.Provider,
    { value: { toasts, show, success, error, warning, info, hide, remove } },
    children,
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    // 服务端调用时返回空实现，永远不会有实际执行
    return {
      toasts: [],
      show: () => '',
      success: () => '',
      error: () => '',
      warning: () => '',
      info: () => '',
      hide: () => {},
      remove: () => {},
    };
  }
  return context;
}

export default useToast;
