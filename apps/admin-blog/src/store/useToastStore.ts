import { create } from 'zustand';
import { ToastMessage } from '../components/UIComponents';

interface ToastState {
  toasts: ToastMessage[];
  addToast: (type: 'success' | 'error' | 'info', message: string) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (type, message) => {
    set((state) => {
      // 相同 type + message 已存在时不重复叠加
      const exists = state.toasts.some(
        (t) => t.type === type && t.message === message,
      );
      if (exists) return state;
      const id = Date.now().toString();
      return { toasts: [...state.toasts, { id, type, message }] };
    });
  },
  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));
