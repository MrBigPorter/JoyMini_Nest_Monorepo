'use client';

import { useState, useCallback, createContext, useContext, ReactNode, useMemo } from 'react';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
}


interface ConfirmState {
  visible: boolean;
  options: ConfirmOptions | null;
  resolve: ((value: boolean) => void) | null;
}

interface ConfirmContextType {
  show: (options: ConfirmOptions) => Promise<boolean>;
  hide: () => void;
  confirm: () => void;
  cancel: () => void;
  state: ConfirmState;
}

const ConfirmContext = createContext<ConfirmContextType | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState>({
    visible: false,
    options: null,
    resolve: null,
  });

  const show = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({
        visible: true,
        options,
        resolve,
      });
    });
  }, []);

  const hide = useCallback(() => {
    setState(prev => {
      prev.resolve?.(false);
      return { visible: false, options: null, resolve: null };
    });
  }, []);

  const confirm = useCallback(() => {
    setState(prev => {
      prev.resolve?.(true);
      return { visible: false, options: null, resolve: null };
    });
  }, []);

  const cancel = useCallback(() => {
    setState(prev => {
      prev.resolve?.(false);
      return { visible: false, options: null, resolve: null };
    });
  }, []);

  const contextValue = useMemo(() => ({
    show,
    hide,
    confirm,
    cancel,
    state,
  }), [show, hide, confirm, cancel, state]);

  return (
    <ConfirmContext.Provider value={contextValue}>
      {children}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    // 服务端调用时返回空实现，永远返回false
    return {
      show: async () => false,
      hide: () => {},
      confirm: () => {},
      cancel: () => {},
      state: { visible: false, options: null, resolve: null },
    };
  }
  return context;
}

export default useConfirm;