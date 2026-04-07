'use client';

import { useToast } from '../hooks/useToast';
import ClientOnly from './ClientOnly';

/**
 * 🍞 Toast 消息容器
 *
 *
 * 完美符合多模式架构规范:
 * ✅ 服务端永远不渲染
 * ✅ 客户端Hydrate完成后才挂载
 * ✅ 零Hydration警告
 *
 * 在根Layout中直接引入即可:
 * ```tsx
 * <ToastProvider>
 *   <ToastContainer />
 *   {children}
 * </ToastProvider>
 * ```
 */
export default function ToastContainer() {
  const { toasts, hide } = useToast();

  return (
    <ClientOnly fallback={null}>
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`
              px-4 py-3 rounded-lg shadow-lg min-w-[300px] max-w-[400px]
              transition-all duration-300 transform
              ${toast.visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full'}
              ${toast.options.type === 'success' ? 'bg-green-500 text-white' : ''}
              ${toast.options.type === 'error' ? 'bg-red-500 text-white' : ''}
              ${toast.options.type === 'warning' ? 'bg-yellow-500 text-white' : ''}
              ${toast.options.type === 'info' ? 'bg-blue-500 text-white' : ''}
            `}
            onClick={() => hide(toast.id)}
          >
            {toast.options.title && (
              <div className="font-semibold mb-1">{toast.options.title}</div>
            )}
            <div>{toast.message}</div>
          </div>
        ))}
      </div>
    </ClientOnly>
  );
}

export { ToastContainer };
